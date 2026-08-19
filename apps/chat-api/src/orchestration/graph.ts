import { Response } from 'express';
import { StateGraph, START, END } from '@langchain/langgraph';
import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
// @ts-ignore: Assume type exists in shared workspace
import { ChatStreamRequest, AIModelType } from '@chat-monorepo/shared';
import { AgentState, AgentStateAnnotation } from './state';
import { agentNode, toolsNode, shouldContinue } from './nodes';
import { buildContext, recordTurnMemories } from '../context/context-builder';
import { generateFollowUpSuggestions } from '../services/suggestions.service';

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
 * Wire format matches the legacy Gemini/OpenAI services exactly
 * ({chunk, done, model, suggestions?, imageUrl?}) so chat.service.ts's SSE
 * parser (which only understands that shape) renders either path identically.
 *
 * Writes nothing to `res` until the first real output chunk is available;
 * if the workflow fails before that point, the error is rethrown so the
 * caller (chat.routes.ts) can fall back to the legacy AIRouterService
 * without having already sent a partial response.
 */
export async function streamGraphResponse(request: ChatStreamRequest, res: Response, ownerId?: string): Promise<void> {
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
  let fullText = '';

  try {
    for await (const event of eventStream) {
      if (event.event === 'on_chat_model_stream') {
        const content = event.data?.chunk?.content;
        if (typeof content === 'string' && content.length > 0) {
          wroteAnyOutput = true;
          fullText += content;
          res.write(`data: ${JSON.stringify({ chunk: content, done: false, model })}\n\n`);
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

  // Long-term memory write-back: deliberately AFTER the stream, and not
  // awaited, so the extraction gate/LLM call never adds latency to a turn.
  recordTurnMemories({ uid: ownerId, threadId: request.threadId, messages: request.messages || [] });

  const suggestions = await generateFollowUpSuggestions(request.messages || [], fullText);
  res.write(`data: ${JSON.stringify({ chunk: '', done: true, model, suggestions })}\n\n`);
  res.end();
}
