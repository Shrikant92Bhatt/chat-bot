import { Response } from 'express';
import { StateGraph, START, END } from '@langchain/langgraph';
import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
// @ts-ignore: Assume type exists in shared workspace
import { ChatAttachment, ChatStreamRequest, AIModelType } from '@chat-monorepo/shared';
import { AgentState, AgentStateAnnotation } from './state';
import { agentNode, toolsNode, shouldContinue } from './nodes';
import { researchNode } from './research';
import { buildContext, recordTurnMemories } from '../context/context-builder';
import { generateFollowUpSuggestions } from '../services/suggestions.service';
import { UsageService } from '../services/usage.service';
import { UiBlockStreamFilter } from './ui-stream-filter';
import { extractOrchestratorUiBlock } from './ui-schema';
import { ModelConfigService } from '../services/model-config.service';
import { SystemLimitsService } from '../services/system-limits.service';
import { AnonUsageService } from '../services/anon-usage.service';

// `research` runs once, ahead of the agent, and self-skips cheaply when the
// turn doesn't need it (see orchestration/research.ts) - which is why it's
// an unconditional edge rather than a branch: the decision needs the
// planner's judgement, not just routing, and keeping it inside the node
// leaves one place that decides whether research happened.
const workflow = new StateGraph(AgentStateAnnotation)
  .addNode('research', researchNode)
  .addNode('agent', agentNode)
  .addNode('tools', toolsNode)
  .addEdge(START, 'research')
  .addEdge('research', 'agent')
  .addConditionalEdges('agent', shouldContinue, { tools: 'tools', end: END })
  .addEdge('tools', 'agent');

const compiledGraph = workflow.compile();

/**
 * Builds a HumanMessage's content, adding one OpenAI-style `image_url` part
 * per image attachment so vision-capable models (Gemini/GPT-4o, both served
 * through this app's OpenAI-compatible gateway - see llm/client.ts) can
 * actually see the photo, not just its filename. Video attachments are
 * intentionally left out here: no model behind this gateway can watch a
 * video, so they're stored/shown in the UI only (see chat.routes.ts
 * POST /attachments) and never sent as model input.
 */
type TextContentBlock = { type: 'text'; text: string };
type ImageContentBlock = { type: 'image'; url: string; mimeType?: string };

function toMessageContent(text: string, attachments?: ChatAttachment[]): string | Array<TextContentBlock | ImageContentBlock> {
  const images = (attachments || []).filter((a) => a.kind === 'image');
  if (images.length === 0) return text;

  const parts: Array<TextContentBlock | ImageContentBlock> = [];
  if (text) parts.push({ type: 'text', text });
  for (const image of images) {
    parts.push({ type: 'image', url: image.url, mimeType: image.contentType });
  }
  return parts;
}

function toBaseMessages(
  messages: Array<{ role: string; content: string; attachments?: ChatAttachment[] }>
): BaseMessage[] {
  return messages.map((m) => {
    if (m.role === 'assistant') return new AIMessage(m.content);
    if (m.role === 'system') return new SystemMessage(m.content);
    return new HumanMessage({ content: toMessageContent(m.content, m.attachments) });
  });
}

/**
 * Cost control for signed-in users is per-MODEL (SelectableModel.
 * dailyLimitPerUser, admin-editable in the Models console) rather than a
 * flat per-user total - most models have no cap at all, and hitting one
 * that does never blocks the turn: this picks a cheaper model to actually
 * serve the reply with instead. Returns null (proceed with the requested
 * model, nothing to report) when the model is uncapped, the user hasn't
 * hit it, or there's no signed-in user to track (anonymous requests are
 * already far more tightly limited by the trial gate in auth.middleware.ts).
 */
async function checkModelQuota(
  requestedModel: AIModelType,
  ownerId: string | undefined
): Promise<{ modelToUse: AIModelType; switchNotice: { fromModel: AIModelType; toModel: AIModelType; resetAt: number } | null }> {
  if (!ownerId) return { modelToUse: requestedModel, switchNotice: null };

  const config = await ModelConfigService.getModelConfig();
  const requested = config.models.find((m) => m.id === requestedModel);
  const cap = requested?.dailyLimitPerUser;
  if (!cap || cap <= 0) return { modelToUse: requestedModel, switchNotice: null };

  const limits = await SystemLimitsService.getLimits();
  const windowMs = limits.rateLimitWindowHours * 60 * 60 * 1000;
  const result = await AnonUsageService.checkAndConsume(AnonUsageService.modelUsageKey(ownerId, requestedModel), cap, windowMs);
  if (result.allowed) return { modelToUse: requestedModel, switchNotice: null };

  // Prefer the configured default model as the fallback (it's the app's
  // own pick for "the model that just works"); if that's somehow the same
  // model that's over its cap, fall back to the first uncapped enabled
  // model, and failing that, the hardcoded floor default.
  const fallback =
    (config.defaultModel !== requestedModel ? config.defaultModel : undefined) ||
    config.models.find((m) => m.id !== requestedModel && m.enabled !== false && !m.dailyLimitPerUser)?.id ||
    'gemini-flash-latest';

  return {
    modelToUse: fallback,
    switchNotice: { fromModel: requestedModel, toModel: fallback, resetAt: result.resetAt },
  };
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
export async function streamGraphResponse(
  request: ChatStreamRequest,
  res: Response,
  ownerId?: string,
  ownerProfile?: { name?: string; email?: string }
): Promise<void> {
  const requestStartedAt = Date.now();
  // Single context-assembly step: project instructions + long-term memory +
  // RAG + conversation summarization, gathered once per request. The
  // resulting bundle is handed to the graph in state and turned into the
  // system prompt by nodes.ts `assembleAgentMessages` (via the Prompt Manager).
  //
  // ownerProfile's name/email come straight from the verified Google
  // session (auth.middleware.ts) - it's the one piece of "who is this"
  // the model previously had zero access to. Without it, a signed-in
  // user asking "do you know me?" got "no" even though the app has known
  // their name since login; memories/the "About you" profile only cover
  // what got explicitly said or written, never this baseline identity.
  const { context, messages: windowedMessages } = await buildContext({
    uid: ownerId,
    userName: ownerProfile?.name,
    userEmail: ownerProfile?.email,
    threadId: request.threadId,
    projectId: request.projectId ?? null,
    messages: request.messages || [],
  });

  const requestedModel: AIModelType = request.model || 'gemini-flash-latest';
  const { modelToUse: model, switchNotice } = await checkModelQuota(requestedModel, ownerId);

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
    deepResearch: request.deepResearch ?? false,
  };

  const eventStream = compiledGraph.streamEvents(initialState, { version: 'v2' });

  let wroteAnyOutput = false;
  let generatedImageUrl: string | null = null;
  // Citations behind whatever the research node gathered this turn, shown
  // to the user alongside any sources the model itself declared in its
  // ```ui block (the two are merged on the final event below).
  let researchSources: Array<{ url: string; title?: string }> = [];
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
      } else if (event.event === 'on_chain_end' && event.name === 'research') {
        const output = event.data?.output as Partial<AgentState> | undefined;
        if (output?.researchSources?.length) {
          researchSources = output.researchSources;
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

  // The model's own declared sources and the research node's citations are
  // both "where this answer came from", so they arrive as one list, deduped
  // by URL with the model's own entries kept first.
  const declaredSources = uiPayload?.sources ?? [];
  const seenSourceUrls = new Set(declaredSources.map((s) => s.url).filter(Boolean));
  const mergedSources = [
    ...declaredSources,
    ...researchSources.filter((s) => s.url && !seenSourceUrls.has(s.url)),
  ];

  const suggestions = await generateFollowUpSuggestions(request.messages || [], visibleText);
  res.write(
    `data: ${JSON.stringify({
      chunk: '',
      done: true,
      model,
      suggestions,
      ...(uiPayload ? { ui: uiPayload.ui, actions: uiPayload.actions } : {}),
      ...(mergedSources.length > 0 ? { sources: mergedSources } : {}),
      ...(switchNotice ? { modelSwitch: switchNotice } : {}),
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
