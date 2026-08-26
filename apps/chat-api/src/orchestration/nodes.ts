import { AIMessage, BaseMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import { UIStreamEvent } from '@chat-monorepo/shared';
import { AgentState, AgentStateUpdate } from './state';
import { createOmniRouteChatModel } from '../llm/client';
import { McpAdapter } from '../mcp/adapter';
import { buildSystemPrompt } from '../prompt/prompt-manager';
import { normalizeToolResultForUi } from './ui-tool-adapter';

const mcpAdapter = new McpAdapter();

/**
 * Context assembly for a single model call.
 *
 * This is the one place where the four context sources — project
 * instructions, long-term memory, RAG excerpts and the conversation summary
 * — are turned into what the LLM actually sees. The gathering (Firestore
 * reads, retrieval, the summarization call) happens once per request in
 * context/context-builder.ts and lands in `state.assembledContext`; this
 * function is pure and cheap, so re-running it on every pass of the
 * agent<->tools loop is free and keeps the system prompt stable across
 * tool round-trips.
 *
 * The prompt text itself lives in the versioned registry under prompt/ —
 * no inline prompt strings here.
 */
export function assembleAgentMessages(state: AgentState): BaseMessage[] {
  const systemPrompt = buildSystemPrompt(state.assembledContext ?? {}, { mcpEnabled: state.mcpEnabled });

  // Drop any SystemMessages already in the history: the Prompt Manager owns
  // the system layer now, and a client-supplied one would silently compete
  // with project instructions and memories.
  const conversation = (state.messages || []).filter((m) => m.getType?.() !== 'system');

  return systemPrompt ? [new SystemMessage(systemPrompt), ...conversation] : conversation;
}

/**
 * Calls the OmniRoute-backed chat model with the assembled context,
 * binding MCP tools so the model can request tool calls via real
 * OpenAI-style function calling (not string matching).
 */
export async function agentNode(state: AgentState): Promise<AgentStateUpdate> {
  const model = createOmniRouteChatModel(state.model, state.temperature);
  const modelWithTools = state.mcpEnabled ? model.bindTools(mcpAdapter.getTools()) : model;

  const response = await modelWithTools.invoke(assembleAgentMessages(state));
  return { messages: [response] };
}

/**
 * Executes whichever tools the last AIMessage requested and appends their
 * results as ToolMessages so the agent node can incorporate them next turn.
 */
export async function toolsNode(state: AgentState): Promise<AgentStateUpdate> {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  const toolCalls = lastMessage.tool_calls || [];

  const toolMessages: ToolMessage[] = [];
  let generatedImageUrl: string | null = state.generatedImageUrl ?? null;
  const pendingUiEvents: UIStreamEvent[] = [];

  for (const call of toolCalls) {
    const result = await mcpAdapter.executeTool(call.name, call.args as Record<string, unknown>);

    if (call.name === 'generate_image') {
      try {
        const parsed = JSON.parse(result);
        if (parsed.imageUrl) {
          generatedImageUrl = parsed.imageUrl;
        }
      } catch {
        // Tool result wasn't parseable JSON — still hand it to the model below.
      }
    }

    // Tool-backed structured UI (weather/stock): normalize the raw tool
    // result into a ui_update/ui_error event so graph.ts can stream the
    // component the moment this tool resolves, rather than waiting for the
    // model's trailing ```ui block at the very end of the reply.
    // Same fallback as the ToolMessage's tool_call_id below, so an id
    // computed here always matches the ui_start id graph.ts emitted for
    // this same call before the tool ran.
    const id = call.id ?? call.name;
    const uiResult = normalizeToolResultForUi(call.name, result);
    if (uiResult) {
      pendingUiEvents.push(
        'error' in uiResult
          ? { type: 'ui_error', id, componentType: uiResult.componentType, message: uiResult.error }
          : { type: 'ui_update', id, componentType: uiResult.componentType, data: uiResult.data }
      );
    }

    toolMessages.push(new ToolMessage({ content: result, tool_call_id: call.id ?? call.name }));
  }

  return { messages: toolMessages, generatedImageUrl, pendingUiEvents };
}

/**
 * Routes to the tools node when the model requested a tool call, otherwise
 * ends the graph run.
 */
export function shouldContinue(state: AgentState): 'tools' | 'end' {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  if (lastMessage?.tool_calls && lastMessage.tool_calls.length > 0) {
    return 'tools';
  }
  return 'end';
}
