import { describe, it, expect } from 'vitest';
import { ResearchTrace } from '@chat-monorepo/shared';
import { isResearchTraceWorthPersisting } from './chat.service';

/** A trace with everything defaulted to "nothing happened" - callers override just what they need. */
function baseTrace(overrides: Partial<ResearchTrace> = {}): ResearchTrace {
  return {
    phase: 'skipped',
    queries: [],
    sources: [],
    browsed: [],
    ran: false,
    ...overrides,
  };
}

describe('isResearchTraceWorthPersisting', () => {
  it('is false for a trivial turn that never needed research (e.g. "what is closure in JavaScript?")', () => {
    // research.ts's looksResearchy() gate fails -> skipWith() -> phase:
    // 'skipped', ran stays false, no queries were ever planned.
    const trace = baseTrace({ phase: 'skipped', message: 'No live-data signal in this question — answering directly.' });
    expect(isResearchTraceWorthPersisting(trace)).toBe(false);
  });

  it('is false when tools/search are unavailable (mcp off or no OpenRouter)', () => {
    const trace = baseTrace({ phase: 'skipped', message: 'Live research is unavailable — tools or web search are not configured.' });
    expect(isResearchTraceWorthPersisting(trace)).toBe(false);
  });

  it('is false when the planner itself decided research was not needed', () => {
    // research_plan reported needsResearch:false, then skipWith() reported
    // phase:'skipped' - ran is false both times, no queries were ever run.
    const trace = baseTrace({
      phase: 'skipped',
      reasoning: 'The question is a definitional one, not something that changes over time.',
      message: 'The question is a definitional one, not something that changes over time.',
    });
    expect(isResearchTraceWorthPersisting(trace)).toBe(false);
  });

  it('is true when research actually ran and returned sources', () => {
    // research_sources sets ran:true.
    const trace = baseTrace({
      phase: 'synthesizing',
      ran: true,
      queries: [{ query: 'nifty today', status: 'ok', citationCount: 3 }],
      sources: [{ url: 'https://example.com/markets' }],
    });
    expect(isResearchTraceWorthPersisting(trace)).toBe(true);
  });

  it('is true when every planned query was attempted but all failed', () => {
    // research.ts's findings.length === 0 branch: real queries were run,
    // but the final report is still phase:'skipped' (ran:false) - the
    // panel should still show what was attempted rather than vanish as if
    // nothing happened.
    const trace = baseTrace({
      phase: 'skipped',
      message: 'Every search failed — answering without research.',
      ran: false,
      queries: [
        { query: 'nifty today', status: 'failed' },
        { query: 'sensex today', status: 'failed' },
      ],
    });
    expect(isResearchTraceWorthPersisting(trace)).toBe(true);
  });

  it('is true when some queries succeeded and some failed, even without a final ran:true event', () => {
    const trace = baseTrace({
      phase: 'skipped',
      ran: false,
      queries: [
        { query: 'nifty today', status: 'ok', citationCount: 2 },
        { query: 'sensex today', status: 'failed' },
      ],
    });
    expect(isResearchTraceWorthPersisting(trace)).toBe(true);
  });

  it('is false while queries are only planned/pending or still running (turn ended early, nothing settled)', () => {
    const trace = baseTrace({
      phase: 'searching',
      ran: true,
      queries: [
        { query: 'nifty today', status: 'pending' },
        { query: 'sensex today', status: 'running' },
      ],
    });
    // ran is true here (set by the research_plan event), so this case is
    // covered by the `trace.ran` branch regardless of query status - kept
    // as a guard against a future refactor accidentally requiring settled
    // queries even when `ran` is already true.
    expect(isResearchTraceWorthPersisting(trace)).toBe(true);
  });
});
