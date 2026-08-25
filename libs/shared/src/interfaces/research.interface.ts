/**
 * The research trace: what the backend streams to the client while a turn
 * is researching, so the wait before the first token is legible rather
 * than a spinner.
 *
 * These events are emitted by the research node via LangChain's
 * `dispatchCustomEvent` (see apps/chat-api/src/orchestration/research.ts),
 * forwarded onto the SSE stream by orchestration/graph.ts, and folded into
 * a ResearchTrace by the client (see chat.service.ts). They are progress
 * reporting only — nothing here is ever part of the assistant's answer.
 */

export type ResearchPhase =
  | 'thinking'
  | 'planning'
  | 'searching'
  | 'browsing'
  | 'synthesizing'
  | 'done'
  | 'skipped';

export interface ResearchSourceRef {
  url: string;
  title?: string;
}

export type ResearchStreamEvent =
  | { type: 'research_status'; phase: ResearchPhase; message?: string }
  | { type: 'research_plan'; needsResearch: boolean; reasoning: string; searchQueries: string[] }
  | { type: 'research_query_start'; query: string; index: number; total: number }
  | {
      type: 'research_query_done';
      query: string;
      index: number;
      ok: boolean;
      preview?: string;
      citationCount?: number;
    }
  | { type: 'research_sources'; sources: ResearchSourceRef[] }
  | { type: 'research_browse_start'; url: string }
  | { type: 'research_browse_done'; url: string; title?: string; ok: boolean };

/** The name research events are dispatched under, shared by emitter and reader. */
export const RESEARCH_EVENT_NAME = 'research';

/** One planned query and how it turned out, as the panel displays it. */
export interface ResearchQueryState {
  query: string;
  status: 'pending' | 'running' | 'ok' | 'failed';
  preview?: string;
  citationCount?: number;
}

/**
 * The client-side accumulation of the events above — what the "Thinking"
 * panel renders. Attached to the assistant message so it survives the turn
 * and can be reopened afterwards.
 */
export interface ResearchTrace {
  phase: ResearchPhase;
  /** Latest human-readable status line. */
  message?: string;
  /** The planner's plain-language justification, shown as the subtitle. */
  reasoning?: string;
  queries: ResearchQueryState[];
  sources: ResearchSourceRef[];
  /** Pages the agent opened with browse_page, if any. */
  browsed: Array<{ url: string; title?: string; ok: boolean }>;
  /** False when research was gated out — the panel says why rather than hiding. */
  ran: boolean;
}
