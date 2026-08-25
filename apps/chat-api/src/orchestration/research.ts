import { HumanMessage } from '@langchain/core/messages';
import { dispatchCustomEvent } from '@langchain/core/callbacks/dispatch';
import { RESEARCH_EVENT_NAME, ResearchStreamEvent } from '@chat-monorepo/shared';
import { createOmniRouteChatModel, isUsingOpenRouter } from '../llm/client';
import { performWebSearch } from '../llm/web-search';
import { renderPrompt } from '../prompt/prompt-manager';
import { AgentState, AgentStateUpdate } from './state';

/**
 * Research planning + parallel evidence gathering, run once before the
 * agent node.
 *
 * Why a planner at all: the agent<->tools loop can already call web_search,
 * but it does so reactively and one query at a time, so a question with
 * several independent parts ("what are Indian markets doing, and which
 * ETFs are liquid enough to swing trade") either gets one vague search or
 * a slow serial chain of them. Planning first turns that into a handful of
 * specific queries that run at once, and the agent starts writing with the
 * evidence already in front of it.
 *
 * The cost of that is one extra LLM call per turn, which is why it is
 * gated three times over: tools must be enabled, the gateway must actually
 * support search, and the message must look like it needs current data
 * (`looksResearchy`). A "rename this variable" turn never pays for a
 * planner call. The planner itself is the final gate - it can still answer
 * needsResearch:false, which is the case the heuristic is deliberately too
 * loose to catch on its own.
 *
 * Inline citation numbering (best-effort, not a guarantee): `formatFindings`
 * numbers the sources it shows the model against `collectSources`'s deduped,
 * first-seen order - the exact array that becomes `researchSources` on the
 * state update below, which graph.ts's `mergedSources` then exposes to the
 * frontend as `data.sources` (declared model sources first, these after).
 * research_findings:v2 tells the model it may cite `[n]` against that same
 * numbering. This is guaranteed self-consistent ONLY when the model doesn't
 * ALSO populate its own ```ui `sources` array for the same turn - nothing in
 * this app's prompts currently instructs it to for a researched turn (the
 * `sources: []` in ui_orchestrator:v2's example is never filled in
 * practice), so in the common case declaredSources is empty and this
 * module's numbering IS the frontend's numbering. If that ever changes, the
 * model's own sources would shift the frontend's numbers ahead of these and
 * silently break the mapping - the frontend's marker renderer treats an
 * out-of-range `[n]` as plain text rather than a broken link specifically
 * because this guarantee is conditional, not absolute.
 */

/** Planner runs on a cheap fast model - this is extraction, not the answer. */
const PLANNER_MODEL = process.env.RESEARCH_PLANNER_MODEL || 'gemini-flash-latest';

const MAX_QUERIES_DEFAULT = 4;
const MAX_QUERIES_DEEP = 6;

/** Per-search wall clock. A slow source must not hold up the whole turn. */
const SEARCH_TIMEOUT_MS = 20000;
/** Wall clock for the planner call itself. */
const PLANNER_TIMEOUT_MS = 12000;

/**
 * Signals that an answer depends on information that changes over time.
 *
 * Deliberately over-inclusive: a false positive costs one cheap planner
 * call that then returns needsResearch:false, while a false negative means
 * the user gets a confidently stale answer. The expensive fan-out only
 * happens after the planner agrees.
 */
const RESEARCH_SIGNALS = [
  // recency
  /\b(today|tonight|tomorrow|yesterday|this (week|month|year|morning|evening)|right now|currently|latest|newest|recent(ly)?|so far|up to date|as of)\b/i,
  /\b(news|headlines?|announced?|announcement|released?|launch(ed|ing)?|upcoming|just came out)\b/i,
  /\b(outlook|forecast|prediction|expected to|will (it|they|there)|what.s next)\b/i,
  // markets
  /\b(stock|shares?|share price|ticker|etf|index|indices|nifty|sensex|nasdaq|dow|s&p|ftse|market|markets|crypto|bitcoin|ethereum|commodit(y|ies)|bond yields?)\b/i,
  /\b(price of|how much (is|does|are)|trading at|market cap|valuation|earnings|ipo|dividend)\b/i,
  // live world state
  /\b(weather|temperature|forecast|rain|snow)\b/i,
  /\b(who won|final score|results?|standings?|fixtures?|election|poll(s|ing)?)\b/i,
  /\b(exchange rate|interest rate|inflation|gdp|unemployment)\b/i,
  // explicit asks
  /\b(search|look ?up|find out|check online|latest info|google)\b/i,
];

/**
 * Reports progress to the client.
 *
 * Uses LangChain's custom-event channel rather than taking a writer as an
 * argument: this node runs inside the compiled graph, which has no handle
 * on the HTTP response. graph.ts picks these up as `on_custom_event` while
 * consuming the same stream it already reads tokens from, so nothing about
 * the response plumbing has to reach in here.
 *
 * Never throws. Progress reporting failing is not a reason to fail a turn,
 * and outside a graph run (unit tests calling the node directly) there is
 * no dispatcher listening at all.
 */
async function report(event: ResearchStreamEvent): Promise<void> {
  try {
    await dispatchCustomEvent(RESEARCH_EVENT_NAME, event);
  } catch {
    // No callback manager in scope - nothing is listening, carry on.
  }
}

/** Cheap pre-filter, ahead of any model call. */
export function looksResearchy(text: string): boolean {
  if (!text || text.trim().length < 3) return false;
  return RESEARCH_SIGNALS.some((pattern) => pattern.test(text));
}

/**
 * Whether this turn is about markets/instruments, which decides only
 * whether the answer gets the finance structure and its risk disclaimer
 * (see finance_answer:v1). Narrower than looksResearchy on purpose - a
 * weather question is researchable but is not investment advice.
 */
const FINANCE_SIGNALS =
  /\b(stock|shares?|share price|ticker|etf|index|indices|nifty|sensex|nasdaq|dow|s&p|ftse|sector|market|markets|crypto|bitcoin|ethereum|portfolio|invest(ing|ment)?|trading|swing trade|intraday|mutual fund|bond|commodit(y|ies)|earnings|ipo|dividend|valuation)\b/i;

export function looksFinancial(text: string): boolean {
  return !!text && FINANCE_SIGNALS.test(text);
}

export interface ResearchFinding {
  query: string;
  answer: string;
  citations: Array<{ url: string; title?: string }>;
}

export interface ResearchSource {
  url: string;
  title?: string;
}

export interface ResearchPlan {
  needsResearch: boolean;
  reasoning: string | null;
  searchQueries: string[];
}

/** Races a promise against a timeout, so one slow call can't stall a turn. */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms.`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Pulls the JSON object out of a planner reply. Models still wrap output in
 * a ```json fence now and then despite being told not to, and that's not
 * worth failing a turn over.
 */
export function parsePlannerJson(raw: string, maxQueries: number): ResearchPlan | null {
  const withoutFence = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');

  // Fall back to the outermost brace pair if the model added stray prose.
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(withoutFence.slice(start, end + 1));
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const candidate = parsed as Record<string, unknown>;

  const queries = Array.isArray(candidate.searchQueries)
    ? candidate.searchQueries
        .filter((q): q is string => typeof q === 'string')
        .map((q) => q.trim())
        .filter(Boolean)
        .slice(0, maxQueries)
    : [];

  return {
    // A plan that says "research" but names no query is not actionable -
    // treat it as a no, rather than fanning out over nothing.
    needsResearch: candidate.needsResearch === true && queries.length > 0,
    reasoning: typeof candidate.reasoning === 'string' ? candidate.reasoning.trim() : null,
    searchQueries: queries,
  };
}

/** Asks the planner model what to search for. */
export async function planResearch(question: string, maxQueries: number): Promise<ResearchPlan | null> {
  const model = createOmniRouteChatModel(PLANNER_MODEL, 0);
  const prompt = renderPrompt('research_planner:v1', {
    question,
    maxQueries: String(maxQueries),
  });

  try {
    const response = await withTimeout(
      model.invoke([new HumanMessage(prompt)]),
      PLANNER_TIMEOUT_MS,
      'Research planner'
    );
    const text = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    return parsePlannerJson(text, maxQueries);
  } catch (error) {
    console.error('[Research] Planner call failed:', error);
    return null;
  }
}

/**
 * Runs every planned query at once. `allSettled` rather than `all` so one
 * dead query degrades the evidence base instead of losing the whole turn -
 * a partial set of findings still beats none.
 */
export async function executeResearch(queries: string[]): Promise<ResearchFinding[]> {
  const settled = await Promise.allSettled(
    queries.map(async (query, index) => {
      await report({ type: 'research_query_start', query, index, total: queries.length });
      try {
        const { answer, citations } = await withTimeout(
          performWebSearch(query),
          SEARCH_TIMEOUT_MS,
          `Search "${query}"`
        );
        await report({
          type: 'research_query_done',
          query,
          index,
          ok: true,
          preview: answer.slice(0, 160),
          citationCount: citations.length,
        });
        return { query, answer, citations } satisfies ResearchFinding;
      } catch (error) {
        await report({ type: 'research_query_done', query, index, ok: false });
        throw error;
      }
    })
  );

  const findings: ResearchFinding[] = [];
  for (const [index, result] of settled.entries()) {
    if (result.status === 'fulfilled') {
      findings.push(result.value);
    } else {
      console.error(`[Research] Query failed ("${queries[index]}"):`, result.reason);
    }
  }
  return findings;
}

/** Deduplicates citations across findings, preserving first-seen order. */
export function collectSources(findings: ResearchFinding[]): ResearchSource[] {
  const seen = new Map<string, ResearchSource>();
  for (const finding of findings) {
    for (const citation of finding.citations || []) {
      if (citation?.url && !seen.has(citation.url)) {
        seen.set(citation.url, { url: citation.url, title: citation.title });
      }
    }
  }
  return Array.from(seen.values());
}

/**
 * Formats findings into the block that research_findings:v2 wraps.
 *
 * `sources` must be `collectSources(findings)` — the SAME deduped,
 * first-seen-order list that becomes `researchSources` on the state update
 * below, which graph.ts then merges (model's own declared sources first,
 * these after) into the final `data.sources` array the frontend numbers as
 * its "Sources" chips. Numbering every citation here against that exact
 * list, rather than restarting per-finding, is what lets the model's own
 * `[n]` inline citations (see research_findings:v2) point at the same
 * source the reader lands on when they click chip `n` - see this module's
 * top-of-file doc comment for the numbering-consistency caveat (it holds
 * only when the model doesn't ALSO declare its own ```ui `sources`, which
 * nothing in this app's prompts currently asks it to do for a researched
 * turn).
 */
export function formatFindings(findings: ResearchFinding[], sources: ResearchSource[]): string {
  const numberByUrl = new Map<string, number>();
  sources.forEach((source, index) => numberByUrl.set(source.url, index + 1));

  const sourceList = sources.length
    ? sources.map((source, index) => `[${index + 1}] ${source.title ? `${source.title} — ` : ''}${source.url}`).join('\n')
    : 'none returned.';

  const findingsBlock = findings
    .map((finding) => {
      const citedNumbers = (finding.citations || [])
        .map((c) => numberByUrl.get(c.url))
        .filter((n): n is number => n !== undefined);
      const citedNote = citedNumbers.length > 0 ? ` — draws on source${citedNumbers.length > 1 ? 's' : ''} ${citedNumbers.map((n) => `[${n}]`).join(', ')}` : '';
      return [`### Searched: "${finding.query}"${citedNote}`, finding.answer.trim()].join('\n');
    })
    .join('\n\n');

  return `## Numbered sources\n${sourceList}\n\n${findingsBlock}`;
}

/** Text of the most recent human turn, which is what gets researched. */
function latestUserQuestion(state: AgentState): string {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const message = state.messages[i];
    if (message.getType?.() !== 'human') continue;
    const { content } = message;
    if (typeof content === 'string') return content;
    // Multimodal turns arrive as content blocks; only the text parts are
    // researchable (an attached photo isn't a search query).
    if (Array.isArray(content)) {
      return content
        .filter((part): part is { type: 'text'; text: string } => (part as { type?: string })?.type === 'text')
        .map((part) => part.text)
        .join(' ');
    }
  }
  return '';
}

/**
 * The research node. Plans, gathers, and folds the evidence into
 * `assembledContext` so the existing Prompt Manager renders it as one more
 * context block (see prompt-manager.buildSystemPrompt) - the agent node
 * needs no special-casing, it just finds the findings already in its
 * system prompt.
 *
 * Always returns a state update rather than throwing: research is an
 * enhancement to a turn, so every failure path here degrades to "answer
 * without it" rather than failing the turn.
 */
export async function researchNode(state: AgentState): Promise<AgentStateUpdate> {
  const skip: AgentStateUpdate = { researchRan: false };

  const skipWith = async (message: string): Promise<AgentStateUpdate> => {
    await report({ type: 'research_status', phase: 'skipped', message });
    return skip;
  };

  await report({ type: 'research_status', phase: 'thinking', message: 'Checking whether this needs live data' });

  // Tools off means the user has opted out of this entire class of
  // behavior, and without OpenRouter there is no search backend to fan out
  // to (see web-search.ts) - planning would just buy a wasted LLM call.
  if (!state.mcpEnabled || !isUsingOpenRouter()) {
    return skipWith('Live research is unavailable — tools or web search are not configured.');
  }

  const question = latestUserQuestion(state);
  if (!question.trim()) return skip;

  const deep = state.deepResearch === true;
  if (!deep && !looksResearchy(question)) {
    return skipWith('No live-data signal in this question — answering directly.');
  }

  await report({ type: 'research_status', phase: 'planning', message: 'Planning searches' });
  const plan = await planResearch(question, deep ? MAX_QUERIES_DEEP : MAX_QUERIES_DEFAULT);

  if (!plan) {
    return skipWith('Could not plan research — answering directly.');
  }

  await report({
    type: 'research_plan',
    needsResearch: plan.needsResearch,
    reasoning: plan.reasoning ?? '',
    searchQueries: plan.searchQueries,
  });

  if (!plan.needsResearch) {
    return skipWith(plan.reasoning || 'No external research needed for this question.');
  }

  await report({
    type: 'research_status',
    phase: 'searching',
    message: `Searching ${plan.searchQueries.length} ${plan.searchQueries.length === 1 ? 'query' : 'queries'} in parallel`,
  });

  const findings = await executeResearch(plan.searchQueries);

  if (findings.length === 0) {
    // Every query failed. The agent still has web_search bound and can
    // retry on its own terms; saying nothing here is better than handing
    // it an empty "findings" block that reads like an absence of evidence.
    await report({ type: 'research_status', phase: 'skipped', message: 'Every search failed — answering without research.' });
    return { researchRan: false, researchQueries: plan.searchQueries };
  }

  const sources = collectSources(findings);
  await report({ type: 'research_sources', sources });
  await report({ type: 'research_status', phase: 'synthesizing', message: 'Writing the answer from these sources' });

  return {
    researchRan: true,
    researchQueries: plan.searchQueries,
    researchSources: sources,
    assembledContext: {
      ...(state.assembledContext ?? {}),
      // formatFindings numbers citations against this SAME `sources` array
      // (see its doc comment) so the model's inline [n] markers line up
      // with the chip numbering graph.ts's mergedSources produces from it.
      researchFindings: formatFindings(findings, sources),
      financeQuestion: looksFinancial(question),
    },
  };
}
