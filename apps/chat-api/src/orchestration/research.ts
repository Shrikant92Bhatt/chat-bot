import { HumanMessage } from '@langchain/core/messages';
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

/** Cheap pre-filter, ahead of any model call. */
export function looksResearchy(text: string): boolean {
  if (!text || text.trim().length < 3) return false;
  return RESEARCH_SIGNALS.some((pattern) => pattern.test(text));
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
    queries.map(async (query) => {
      const { answer, citations } = await withTimeout(
        performWebSearch(query),
        SEARCH_TIMEOUT_MS,
        `Search "${query}"`
      );
      return { query, answer, citations } satisfies ResearchFinding;
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

/** Formats findings into the block that research_findings:v1 wraps. */
export function formatFindings(findings: ResearchFinding[]): string {
  return findings
    .map((finding, index) => {
      const sources = (finding.citations || [])
        .map((c) => `  - ${c.title ? `${c.title} — ` : ''}${c.url}`)
        .join('\n');
      return [
        `### Finding ${index + 1} — searched: "${finding.query}"`,
        finding.answer.trim(),
        sources ? `Sources:\n${sources}` : 'Sources: none returned.',
      ].join('\n');
    })
    .join('\n\n');
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

  // Tools off means the user has opted out of this entire class of
  // behavior, and without OpenRouter there is no search backend to fan out
  // to (see web-search.ts) - planning would just buy a wasted LLM call.
  if (!state.mcpEnabled || !isUsingOpenRouter()) return skip;

  const question = latestUserQuestion(state);
  if (!question.trim()) return skip;

  const deep = state.deepResearch === true;
  if (!deep && !looksResearchy(question)) return skip;

  const plan = await planResearch(question, deep ? MAX_QUERIES_DEEP : MAX_QUERIES_DEFAULT);
  if (!plan || !plan.needsResearch) return skip;

  const findings = await executeResearch(plan.searchQueries);
  if (findings.length === 0) {
    // Every query failed. The agent still has web_search bound and can
    // retry on its own terms; saying nothing here is better than handing
    // it an empty "findings" block that reads like an absence of evidence.
    return { researchRan: false, researchQueries: plan.searchQueries };
  }

  return {
    researchRan: true,
    researchQueries: plan.searchQueries,
    researchSources: collectSources(findings),
    assembledContext: {
      ...(state.assembledContext ?? {}),
      researchFindings: formatFindings(findings),
    },
  };
}
