import { describe, it, expect } from 'vitest';
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import {
  looksResearchy,
  parsePlannerJson,
  collectSources,
  formatFindings,
  researchNode,
} from './research';
import type { AgentState } from './state';

/** Only the fields researchNode actually reads. */
function stateWith(partial: Partial<AgentState>): AgentState {
  return { messages: [], mcpEnabled: false, ...partial } as AgentState;
}

describe('Research: the cheap heuristic gate', () => {
  it('triggers on questions whose answer changes over time', () => {
    for (const question of [
      'Analyse Indian stock market, suggest an ETF for tomorrow',
      'what is the latest news on the election',
      'nifty outlook for this week',
      'what is the price of TSLA',
      'weather in Pune today',
      'who won the match yesterday',
      'current inflation rate in India',
      'search for the newest Angular release',
    ]) {
      expect(looksResearchy(question), question).toBe(true);
    }
  });

  it('stays out of the way on turns that need no live data', () => {
    for (const question of [
      'write a function that reverses a linked list',
      'explain the difference between let and const',
      'refactor this component to use signals',
      'why is my regex not matching parentheses',
      'hi',
      '',
    ]) {
      expect(looksResearchy(question), question).toBe(false);
    }
  });
});

describe('Research: parsing the planner reply', () => {
  it('reads a clean JSON plan', () => {
    const plan = parsePlannerJson(
      '{"needsResearch":true,"reasoning":"needs live levels","searchQueries":["nifty close today","bank nifty levels"]}',
      4
    );
    expect(plan?.needsResearch).toBe(true);
    expect(plan?.searchQueries).toEqual(['nifty close today', 'bank nifty levels']);
    expect(plan?.reasoning).toBe('needs live levels');
  });

  it('survives a ```json fence the model was told not to add', () => {
    const plan = parsePlannerJson('```json\n{"needsResearch":true,"searchQueries":["x"]}\n```', 4);
    expect(plan?.needsResearch).toBe(true);
    expect(plan?.searchQueries).toEqual(['x']);
  });

  it('survives stray prose around the object', () => {
    const plan = parsePlannerJson(
      'Sure! Here is the plan:\n{"needsResearch":true,"searchQueries":["y"]}\nHope that helps.',
      4
    );
    expect(plan?.searchQueries).toEqual(['y']);
  });

  it('enforces the query cap so the fan-out stays bounded', () => {
    const plan = parsePlannerJson(
      '{"needsResearch":true,"searchQueries":["1","2","3","4","5","6","7","8"]}',
      4
    );
    expect(plan?.searchQueries).toHaveLength(4);
  });

  it('treats "research, but no queries" as no research', () => {
    // Not actionable - fanning out over nothing would just cost a turn's
    // latency and return an empty findings block that reads like evidence
    // of absence.
    const plan = parsePlannerJson('{"needsResearch":true,"searchQueries":[]}', 4);
    expect(plan?.needsResearch).toBe(false);
  });

  it('drops non-string and blank queries', () => {
    const plan = parsePlannerJson(
      '{"needsResearch":true,"searchQueries":["ok", 42, null, "  ", "  fine  "]}',
      4
    );
    expect(plan?.searchQueries).toEqual(['ok', 'fine']);
  });

  it('returns null on unparseable output so the caller can degrade', () => {
    for (const bad of ['not json at all', '', '{oops', '[]']) {
      expect(parsePlannerJson(bad, 4), bad).toBeNull();
    }
  });
});

describe('Research: assembling findings', () => {
  it('dedupes sources by URL and keeps the first-seen entry', () => {
    const sources = collectSources([
      { query: 'q1', answer: 'a', citations: [{ url: 'u1', title: 'One' }, { url: 'u2' }] },
      { query: 'q2', answer: 'b', citations: [{ url: 'u2', title: 'Dup' }, { url: 'u3', title: 'Three' }] },
    ]);
    expect(sources.map((s) => s.url)).toEqual(['u1', 'u2', 'u3']);
    expect(sources[1].title).toBeUndefined();
  });

  it('tolerates a finding that returned no citations', () => {
    expect(collectSources([{ query: 'q', answer: 'a', citations: [] }])).toEqual([]);
  });

  it('renders each query, its answer and its sources', () => {
    const findings = [
      { query: 'nifty level', answer: 'Nifty closed at 24,850.', citations: [{ url: 'https://x.test', title: 'X' }] },
    ];
    const text = formatFindings(findings, collectSources(findings));
    expect(text).toContain('nifty level');
    expect(text).toContain('24,850');
    expect(text).toContain('https://x.test');
  });

  it('says so explicitly when a query returned no sources', () => {
    const findings = [{ query: 'q', answer: 'a', citations: [] }];
    expect(formatFindings(findings, collectSources(findings))).toContain('none returned');
  });

  it('numbers the sources list to match collectSources order, and notes which numbers each finding drew on', () => {
    const findings = [
      { query: 'q1', answer: 'a1', citations: [{ url: 'https://a.test', title: 'A' }, { url: 'https://b.test', title: 'B' }] },
      { query: 'q2', answer: 'a2', citations: [{ url: 'https://b.test', title: 'B' }] },
    ];
    const sources = collectSources(findings);
    const text = formatFindings(findings, sources);

    // Sources list numbered 1..N in collectSources's dedup order.
    expect(text).toContain('[1] A — https://a.test');
    expect(text).toContain('[2] B — https://b.test');
    // Only 2 unique sources despite 3 citations across findings (B dedup'd).
    expect(sources).toHaveLength(2);

    // First finding cites both; second finding cites only the second source.
    const q1Section = text.split('### Searched: "q1"')[1].split('### Searched: "q2"')[0];
    expect(q1Section).toContain('[1]');
    expect(q1Section).toContain('[2]');
    const q2Section = text.split('### Searched: "q2"')[1];
    expect(q2Section).not.toContain('[1]');
    expect(q2Section).toContain('[2]');
  });

  it('numbers an empty sources list as "none returned" rather than "[1] none returned"', () => {
    const findings = [{ query: 'q', answer: 'a', citations: [] }];
    const text = formatFindings(findings, []);
    expect(text).toContain('none returned.');
    expect(text).not.toMatch(/\[1\]\s*none returned/);
  });
});

describe('Research: the node degrades instead of failing the turn', () => {
  it('skips entirely when the user has tools switched off', async () => {
    const update = await researchNode(
      stateWith({ mcpEnabled: false, messages: [new HumanMessage('nifty outlook today')] })
    );
    expect(update.researchRan).toBe(false);
  });

  it('skips when no search-capable gateway is configured', async () => {
    // web_search needs OpenRouter (see llm/web-search.ts); without it,
    // planning would buy an LLM call whose whole fan-out is going to fail.
    const update = await researchNode(
      stateWith({ mcpEnabled: true, messages: [new HumanMessage('nifty outlook today')] })
    );
    expect(update.researchRan).toBe(false);
  });

  it('skips a turn with no human message to research', async () => {
    for (const messages of [[], [new AIMessage('assistant only')], [new HumanMessage('   ')]]) {
      const update = await researchNode(stateWith({ mcpEnabled: true, messages }));
      expect(update.researchRan).toBe(false);
    }
  });

  it('handles a multimodal turn without throwing', async () => {
    const update = await researchNode(
      stateWith({
        mcpEnabled: true,
        messages: [new HumanMessage({ content: [{ type: 'image', url: 'https://img.test/a.png' }] })],
      })
    );
    expect(update.researchRan).toBe(false);
  });
});
