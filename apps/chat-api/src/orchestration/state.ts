import { Annotation, MessagesAnnotation } from '@langchain/langgraph';
import { UIStreamEvent } from '@chat-monorepo/shared';
import { AssembledContext, EMPTY_CONTEXT } from '../prompt/prompt-manager';

/**
 * LangGraph state for the chat orchestration graph.
 * Extends the built-in messages channel (append-only, BaseMessage[]) with
 * the extra fields the chat workflow needs to carry between nodes.
 */
export const AgentStateAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  model: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => 'gpt-4o-mini',
  }),
  temperature: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => 0.7,
  }),
  mcpEnabled: Annotation<boolean>({
    reducer: (_left, right) => right,
    default: () => false,
  }),
  ragContext: Annotation<string[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  generatedImageUrl: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  /**
   * Everything the context-assembly step gathered before the run started
   * (project instructions, long-term memories, RAG excerpts, conversation
   * summary). Built once per request by context/context-builder.ts and read
   * by `agentNode` on every pass of the agent<->tools loop, so the system
   * prompt stays identical across tool round-trips.
   */
  assembledContext: Annotation<AssembledContext>({
    reducer: (_left, right) => right,
    default: () => EMPTY_CONTEXT,
  }),
  /** Owner uid — null for anonymous/trial turns. */
  userId: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  /** Project the conversation is scoped to, if any. */
  projectId: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  threadId: Annotation<string | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  /**
   * Opt-in deep research: skips the recency heuristic (always plans) and
   * allows a wider search fan-out. See orchestration/research.ts.
   */
  deepResearch: Annotation<boolean>({
    reducer: (_left, right) => right,
    default: () => false,
  }),
  /** True once the research node actually gathered evidence for this turn. */
  researchRan: Annotation<boolean>({
    reducer: (_left, right) => right,
    default: () => false,
  }),
  /** The queries the planner chose - surfaced for the admin emulator. */
  researchQueries: Annotation<string[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  /** Deduplicated citations behind this turn's findings, shown to the user. */
  researchSources: Annotation<Array<{ url: string; title?: string }>>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  /**
   * ui_update/ui_error events produced by the most recent tools-node pass
   * (see nodes.ts toolsNode, orchestration/ui-tool-adapter.ts) - read once
   * by graph.ts's on_chain_end('tools') handler and forwarded over SSE, so
   * a tool-backed component (weather/stock) can render the moment its tool
   * call resolves instead of waiting for the full reply to finish.
   */
  pendingUiEvents: Annotation<UIStreamEvent[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
});

export type AgentState = typeof AgentStateAnnotation.State;
export type AgentStateUpdate = typeof AgentStateAnnotation.Update;
