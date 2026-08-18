import { Annotation, MessagesAnnotation } from '@langchain/langgraph';

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
});

export type AgentState = typeof AgentStateAnnotation.State;
export type AgentStateUpdate = typeof AgentStateAnnotation.Update;
