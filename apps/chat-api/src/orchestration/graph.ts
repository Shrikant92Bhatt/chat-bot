import { Response } from 'express';
import { StateGraph, START, END } from '@langchain/langgraph';
import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
// @ts-ignore: Assume type exists in shared workspace
import {
  ChatAttachment,
  ChatStreamRequest,
  AIModelType,
  ResearchStreamEvent,
  RESEARCH_EVENT_NAME,
  UIComponent,
  UIStreamEvent,
  AUTO_MODEL_ID,
  DEFAULT_MODEL_ID,
} from '@chat-monorepo/shared';
import { AgentState, AgentStateAnnotation } from './state';
import { agentNode, toolsNode, shouldContinue } from './nodes';
import { researchNode } from './research';
import { isUsingOpenRouter } from '../llm/client';
import { buildContext, recordTurnMemories } from '../context/context-builder';
import { generateFollowUpSuggestions } from '../services/suggestions.service';
import { UsageService } from '../services/usage.service';
import { UiBlockStreamFilter } from './ui-stream-filter';
import { ToolResultLeakStreamFilter } from './tool-leak-stream-filter';
import { extractOrchestratorUiBlock } from './ui-schema';
import { TOOL_UI_COMPONENT_MAP } from './ui-tool-adapter';
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
 * Human-readable activity labels for the tools the agent can call, used for
 * the live status line during a turn. A tool with no entry here falls back
 * to its raw name, which is still more informative than silence.
 */
const TOOL_ACTIVITY_LABELS: Record<string, string> = {
  web_search: 'Searching the web',
  browse_page: 'Reading a page',
  get_weather: 'Checking the weather',
  get_stock_quote: 'Checking the market',
  system_calculator: 'Calculating',
  code_interpreter: 'Running code',
  generate_image: 'Generating an image',
  generate_video: 'Generating a video',
  list_screeners: 'Listing ETF screeners',
  run_screener: 'Running an ETF screen',
  get_etf_snapshot: 'Fetching ETF quotes',
  get_etf_analysis: 'Analyzing an ETF',
  get_market_status: 'Checking market status',
};

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
 * structured extras when present. A tool-backed component (weather/stock)
 * additionally streams live as {uiEvent, done: false} events before that
 * final event - see ui-tool-adapter.ts and ui-stream.interface.ts - and is
 * folded into the final `ui` array too, so the persisted message is
 * identical whether or not the client happened to render the live version.
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

  // Auto resolves to `openrouter/auto`, which only exists on OpenRouter. A
  // client that still has it selected when the gateway is the self-hosted
  // OmniRoute (config changed under it, or a stale cached model list) would
  // otherwise send a slug that gateway cannot serve, failing every turn -
  // fall back to the default rather than 500ing on the user's message.
  const requestedModel: AIModelType =
    request.model === AUTO_MODEL_ID && !isUsingOpenRouter()
      ? DEFAULT_MODEL_ID
      : request.model || DEFAULT_MODEL_ID;
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
  let generatedVideoUrl: string | null = null;
  // Citations behind whatever the research node gathered this turn, shown
  // to the user alongside any sources the model itself declared in its
  // ```ui block (the two are merged on the final event below).
  let researchSources: Array<{ url: string; title?: string }> = [];
  // The model may append a trailing ```ui fenced block (see
  // ui_orchestrator:v1) with structured UI data. uiFilter withholds that
  // block from the live token stream so its raw JSON never flashes on
  // screen; visibleText accumulates only what actually gets shown to the
  // user, which is also what follow-up suggestions are generated from.
  //
  // leakFilter is a second, independent pass over whatever uiFilter judged
  // safe to show - a best-effort backstop for the case the fenced-block
  // filter above can't cover: the model narrating a tool's raw JSON in
  // prose WITHOUT the ```ui fence (see tool-leak-stream-filter.ts for what
  // it does and does not guarantee).
  const uiFilter = new UiBlockStreamFilter();
  const leakFilter = new ToolResultLeakStreamFilter();
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
  /** The slug the gateway says answered - see on_chat_model_end below. */
  let servedModel: string | null = null;

  /**
   * Forwards a research-trace event to the client.
   *
   * Research and tool round-trips happen entirely ahead of the first
   * token, so without these the user stares at an idle spinner for several
   * seconds with no idea whether anything is happening. They are progress
   * reporting only and never become part of the reply.
   */
  const emitResearch = (event: ResearchStreamEvent) => {
    res.write(`data: ${JSON.stringify({ research: event, done: false, model })}\n\n`);
  };

  /**
   * Forwards a tool-backed UI component's lifecycle to the client (see
   * ui-stream.interface.ts) - loading the instant the model calls
   * get_weather/get_stock_quote, then its data or an error the instant the
   * tool resolves. Same purpose as emitResearch above: make the wait
   * legible and get the card on screen before the rest of the reply has
   * even finished streaming, instead of only after the trailing ```ui
   * block is parsed at the very end.
   */
  const emitUi = (event: UIStreamEvent) => {
    res.write(`data: ${JSON.stringify({ uiEvent: event, done: false, model })}\n\n`);
  };
  // Successfully resolved tool-backed components, folded into the final
  // `ui` payload below so they persist on the message (thread reload,
  // regenerate) exactly like a model-authored ```ui component would.
  const toolUiComponents: UIComponent[] = [];

  try {
    for await (const event of eventStream) {
      if (event.event === 'on_custom_event' && event.name === RESEARCH_EVENT_NAME) {
        emitResearch(event.data as ResearchStreamEvent);
      } else if (event.event === 'on_chat_model_stream') {
        const content = event.data?.chunk?.content;
        if (typeof content === 'string' && content.length > 0) {
          const visible = leakFilter.push(uiFilter.push(content));
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

        // Which model actually answered. Only interesting under Auto, where
        // the app asked OpenRouter to choose and otherwise has no idea what
        // it picked - leaving the user with a reply they cannot attribute
        // and a usage row costed against a slug that never ran.
        //
        // Read defensively: the field the gateway populates is not
        // guaranteed, and an unattributed reply is a far better outcome
        // than a failed turn.
        const metadata = event.data?.output?.response_metadata as Record<string, unknown> | undefined;
        const reported = metadata?.model_name ?? metadata?.model;
        if (typeof reported === 'string' && reported.trim()) {
          servedModel = reported.trim();
        }
      } else if (event.event === 'on_chain_end' && event.name === 'research') {
        const output = event.data?.output as Partial<AgentState> | undefined;
        if (output?.researchSources?.length) {
          researchSources = output.researchSources;
        }
      } else if (event.event === 'on_chain_end' && event.name === 'agent') {
        // The agent has decided; the tools node runs next. Reporting from
        // here (rather than inside the tools node) is what makes the wait
        // legible while those tools actually execute.
        const output = event.data?.output as { messages?: BaseMessage[] } | undefined;
        const last = output?.messages?.[output.messages.length - 1] as AIMessage | undefined;
        const toolCalls = last?.tool_calls ?? [];

        for (const call of toolCalls) {
          if (call.name === 'browse_page') {
            const url = (call.args as { url?: string })?.url;
            if (url) emitResearch({ type: 'research_browse_start', url });
          }
          const componentType = TOOL_UI_COMPONENT_MAP[call.name];
          if (componentType) {
            // Same id fallback as toolsNode/nodes.ts uses for this same
            // call once it resolves - see the comment there.
            emitUi({ type: 'ui_start', id: call.id ?? call.name, componentType });
          }
        }

        if (toolCalls.length > 0) {
          const labels = toolCalls.map((call) => TOOL_ACTIVITY_LABELS[call.name] ?? call.name);
          emitResearch({
            type: 'research_status',
            phase: toolCalls.some((c) => c.name === 'browse_page') ? 'browsing' : 'searching',
            message: labels.join(' · '),
          });
        }
      } else if (event.event === 'on_chain_end' && event.name === 'tools') {
        const output = event.data?.output as Partial<AgentState> | undefined;
        if (output?.generatedImageUrl) {
          generatedImageUrl = output.generatedImageUrl;
          wroteAnyOutput = true;
          res.write(`data: ${JSON.stringify({ imageUrl: generatedImageUrl, done: false, model })}\n\n`);
        }
        if (output?.generatedVideoUrl) {
          generatedVideoUrl = output.generatedVideoUrl;
          wroteAnyOutput = true;
          res.write(`data: ${JSON.stringify({ videoUrl: generatedVideoUrl, done: false, model })}\n\n`);
        }
        for (const uiEvent of output?.pendingUiEvents ?? []) {
          emitUi(uiEvent);
          if (uiEvent.type === 'ui_update') {
            toolUiComponents.push({ type: uiEvent.componentType, id: uiEvent.id, data: uiEvent.data } as UIComponent);
          }
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
  const trailingSafe = (trailingVisible.length > 0 ? leakFilter.push(trailingVisible) : '') + leakFilter.finish();
  if (trailingSafe.length > 0) {
    wroteAnyOutput = true;
    visibleText += trailingSafe;
    res.write(`data: ${JSON.stringify({ chunk: trailingSafe, done: false, model })}\n\n`);
  }
  const uiPayload = rawUiBlock ? extractOrchestratorUiBlock(rawUiBlock) : null;

  // Tool-backed components (already streamed live via emitUi above) are the
  // authoritative source for their id; the model's own ```ui block is only
  // consulted for ids it didn't already produce, so a model that echoes the
  // same weather/stock card back doesn't render it twice.
  const toolUiIds = new Set(toolUiComponents.map((c) => c.id));
  const mergedUi = [...toolUiComponents, ...(uiPayload?.ui ?? []).filter((c) => !toolUiIds.has(c.id))];

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

  // Defensive fallback: a turn that produced genuinely nothing - no visible
  // text, no image/video, no UI card, no sources - previously ended the
  // stream with an empty `chunk: ''` and nothing else, leaving a permanently
  // blank assistant bubble with zero indication anything went wrong (no
  // error event fires here, since nothing actually threw). This can happen
  // without a hard provider error, e.g. the model returns an empty
  // completion, or writes its entire "answer" inside a ```ui fence with no
  // prose and the fence turns out not to parse into anything renderable.
  // Surfacing it explicitly turns a silent, undiagnosable gap into a
  // visible, retryable one - same principle as the thread-save and video-
  // generation error fixes elsewhere in this file's history.
  if (!wroteAnyOutput && mergedUi.length === 0 && mergedSources.length === 0) {
    const fallback = "I wasn't able to generate a response for that. Could you try rephrasing, or ask again?";
    visibleText = fallback;
    res.write(`data: ${JSON.stringify({ chunk: fallback, done: false, model })}\n\n`);
  }

  const suggestions = await generateFollowUpSuggestions(request.messages || [], visibleText);
  res.write(
    `data: ${JSON.stringify({
      chunk: '',
      done: true,
      model,
      suggestions,
      ...(mergedUi.length > 0 ? { ui: mergedUi } : {}),
      ...(uiPayload?.actions?.length ? { actions: uiPayload.actions } : {}),
      ...(mergedSources.length > 0 ? { sources: mergedSources } : {}),
      ...(switchNotice ? { modelSwitch: switchNotice } : {}),
      // Only sent under Auto: for a directly-chosen model the client
      // already knows what answered, and echoing it back would just be the
      // same name twice in the UI.
      ...(model === AUTO_MODEL_ID && servedModel ? { servedModel } : {}),
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
      // Under Auto, 'auto' is not a billable model - it has no rate of its
      // own, and costing against it would attribute every routed turn to a
      // placeholder. Log the model that actually ran so the usage and cost
      // reports stay meaningful.
      model: model === AUTO_MODEL_ID && servedModel ? servedModel : model,
      inputTokens: sawUsageMetadata ? inputTokens : null,
      outputTokens: sawUsageMetadata ? outputTokens : null,
      latencyMs: Date.now() - requestStartedAt,
    });
  } catch (usageLogError) {
    console.error('[StreamGraph] Failed to log usage record:', usageLogError);
  }
}
