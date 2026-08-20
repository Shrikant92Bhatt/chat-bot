import { Response } from 'express';
import { StateGraph, START, END } from '@langchain/langgraph';
import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
// @ts-ignore: Assume type exists in shared workspace
import { ChatStreamRequest, AIModelType } from '@chat-monorepo/shared';
import { AgentState, AgentStateAnnotation } from './state';
import { agentNode, toolsNode, shouldContinue } from './nodes';
import { buildContext, recordTurnMemories } from '../context/context-builder';
import { generateFollowUpSuggestions } from '../services/suggestions.service';
import { UsageService } from '../services/usage.service';
import { UiBlockStreamFilter } from './ui-stream-filter';
import { extractOrchestratorUiBlock } from './ui-schema';

const workflow = new StateGraph(AgentStateAnnotation)
  .addNode('agent', agentNode)
  .addNode('tools', toolsNode)
  .addEdge(START, 'agent')
  .addConditionalEdges('agent', shouldContinue, { tools: 'tools', end: END })
  .addEdge('tools', 'agent');

const compiledGraph = workflow.compile();

function toBaseMessages(messages: Array<{ role: string; content: string }>): BaseMessage[] {
  return messages.map((m) => {
    if (m.role === 'assistant') return new AIMessage(m.content);
    if (m.role === 'system') return new SystemMessage(m.content);
    return new HumanMessage(m.content);
  });
}

/**
 * Runs the LangGraph orchestration workflow and streams the model's tokens
 * back to the client over SSE as they arrive.
 *
 * Wire format matches the legacy Gemini/OpenAI services
 * ({chunk, done, model, suggestions?, imageUrl?}) plus this path's own
 * optional {ui?, sources?, actions?} on the final `done: true` event - see
 * ui-schema.ts/ui-stream-filter.ts - so chat.service.ts's SSE parser renders
 * either path's plain text identically and additively picks up the
 * structured extras when present.
 *
 * Writes nothing to `res` until the first real output chunk is available;
 * if the workflow fails before that point, the error is rethrown so the
 * caller (chat.routes.ts) can fall back to the legacy AIRouterService
 * without having already sent a partial response.
 */
export async function streamGraphResponse(request: ChatStreamRequest, res: Response, ownerId?: string): Promise<void> {
  const requestStartedAt = Date.now();
  // Single context-assembly step: project instructions + long-term memory +
  // RAG + conversation summarization, gathered once per request. The
  // resulting bundle is handed to the graph in state and turned into the
  // system prompt by nodes.ts `assembleAgentMessages` (via the Prompt Manager).
  const { context, messages: windowedMessages } = await buildContext({
    uid: ownerId,
    threadId: request.threadId,
    projectId: request.projectId ?? null,
    messages: request.messages || [],
  });

  const model: AIModelType = request.model || 'gemini-flash-latest';

  const initialState: Partial<AgentState> = {
    messages: toBaseMessages(windowedMessages),
    model,
    temperature: request.temperature ?? 0.7,
    mcpEnabled: request.mcpEnabled ?? false,
    ragContext: context.ragContext ?? [],
    assembledContext: context,
    userId: ownerId ?? null,
    projectId: request.projectId ?? null,
    threadId: request.threadId ?? null,
  };

  const eventStream = compiledGraph.streamEvents(initialState, { version: 'v2' });

  let wroteAnyOutput = false;
  let generatedImageUrl: string | null = null;
  // The model may append a trailing ```ui fenced block (see
  // ui_orchestrator:v1) with structured UI data. uiFilter withholds that
  // block from the live token stream so its raw JSON never flashes on
  // screen; visibleText accumulates only what actually gets shown to the
  // user, which is also what follow-up suggestions are generated from.
  const uiFilter = new UiBlockStreamFilter();
  let visibleText = '';

  // Summed across every model invocation in this turn (the agent<->tools
  // loop can call the model more than once) - `usage_metadata` on the
  // on_chat_model_end output is populated by @langchain/openai only when
  // the gateway actually returns a `usage` field (verified: ChatOpenAI
  // defaults `streamUsage: true`, which sends `stream_options:
  // {include_usage: true}`; OpenRouter honors this. The local/self-hosted
  // OmniRoute gateway's behavior here is NOT verified - if it doesn't
  // return usage, these stay null and no cost is fabricated below).
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let sawUsageMetadata = false;

  try {
    for await (const event of eventStream) {
      if (event.event === 'on_chat_model_stream') {
        const content = event.data?.chunk?.content;
        if (typeof content === 'string' && content.length > 0) {
          const visible = uiFilter.push(content);
          if (visible.length > 0) {
            wroteAnyOutput = true;
            visibleText += visible;
            res.write(`data: ${JSON.stringify({ chunk: visible, done: false, model })}\n\n`);
          }
        }
      } else if (event.event === 'on_chat_model_end') {
        const usage = event.data?.output?.usage_metadata;
        if (usage) {
          sawUsageMetadata = true;
          inputTokens = (inputTokens ?? 0) + (usage.input_tokens ?? 0);
          outputTokens = (outputTokens ?? 0) + (usage.output_tokens ?? 0);
        }
      } else if (event.event === 'on_chain_end' && event.name === 'tools') {
        const output = event.data?.output as Partial<AgentState> | undefined;
        if (output?.generatedImageUrl) {
          generatedImageUrl = output.generatedImageUrl;
          wroteAnyOutput = true;
          res.write(`data: ${JSON.stringify({ imageUrl: generatedImageUrl, done: false, model })}\n\n`);
        }
      }
    }
  } catch (error) {
    if (!wroteAnyOutput) {
      // Nothing has been sent to the client yet — safe to let the caller
      // fall back to the legacy AIRouterService.
      throw error;
    }
    console.error('[StreamGraph] Workflow error mid-stream:', error);
    res.write(`data: ${JSON.stringify({ error: (error as Error).message, done: true })}\n\n`);
    res.end();
    return;
  }

  // Flush whatever the fence filter was still holding back (either trailing
  // text that turned out not to be a ```ui fence, or - if a fence was
  // opened - nothing, since that's the captured block below instead).
  const { trailingVisible, rawUiBlock } = uiFilter.finish();
  if (trailingVisible.length > 0) {
    wroteAnyOutput = true;
    visibleText += trailingVisible;
    res.write(`data: ${JSON.stringify({ chunk: trailingVisible, done: false, model })}\n\n`);
  }
  const uiPayload = rawUiBlock ? extractOrchestratorUiBlock(rawUiBlock) : null;

  // Long-term memory write-back: deliberately AFTER the stream, and not
  // awaited, so the extraction gate/LLM call never adds latency to a turn.
  recordTurnMemories({ uid: ownerId, threadId: request.threadId, messages: request.messages || [] });

  const suggestions = await generateFollowUpSuggestions(request.messages || [], visibleText);
  res.write(
    `data: ${JSON.stringify({
      chunk: '',
      done: true,
      model,
      suggestions,
      ...(uiPayload ? { ui: uiPayload.ui, sources: uiPayload.sources, actions: uiPayload.actions } : {}),
    })}\n\n`
  );
  res.end();

  // Logged after res.end() so a Firestore hiccup never delays or breaks the
  // chat response itself; failures here are swallowed (logged) rather than
  // surfaced, since usage/cost logging is diagnostic, not user-facing.
  try {
    await UsageService.logUsage({
      userId: ownerId ?? null,
      tenantId: null,
      conversationId: request.threadId ?? null,
      model,
      inputTokens: sawUsageMetadata ? inputTokens : null,
      outputTokens: sawUsageMetadata ? outputTokens : null,
      latencyMs: Date.now() - requestStartedAt,
    });
  } catch (usageLogError) {
    console.error('[StreamGraph] Failed to log usage record:', usageLogError);
  }
}
