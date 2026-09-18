import { HumanMessage } from '@langchain/core/messages';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createOmniRouteChatModel, isOmniRouteConfigured, resolveOmniRouteModel } from './client';

export interface UtilityModelResult {
  text: string;
  /** The model that actually answered - the resolved gateway slug when
   *  routed through OpenRouter/OmniRoute, or the requested model id when
   *  the direct-Gemini fallback below was used. Always a real, billable
   *  model id, never a placeholder like 'auto'. */
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

function cleanEnvVar(val?: string): string {
  if (!val) return '';
  return val.replace(/^﻿/, '').replace(/\r/g, '').trim();
}

const DEFAULT_UTILITY_MODEL = 'gemini-flash-latest';

/**
 * Shared path for small, non-agentic "side-call" prompts that support a chat
 * turn without being the chat turn itself: conversation summarization
 * (summarization/summarizer.ts), memory extraction (memory/extractor.ts),
 * and follow-up suggestions (services/suggestions.service.ts).
 *
 * All three used to hand-roll their own direct `@google/generative-ai` call.
 * Two problems with that: (1) it always hit Google directly even when
 * OpenRouter/OmniRoute is the configured gateway for the actual chat model,
 * splitting real spend across two billing surfaces that can't see each
 * other - the app's own usage dashboard AND OpenRouter's dashboard both miss
 * it, only Google AI Studio's raw billing shows it; (2) none of them ever
 * read the token usage the SDK already returns, so this real cost never
 * reached UsageService. Routing these through the same `createOmniRouteChatModel`
 * factory the main agent (orchestration/nodes.ts) and research planner
 * (orchestration/research.ts) already use fixes both: one gateway, one
 * place to see the spend, and the same `usage_metadata` field graph.ts
 * already reads off the main model's response.
 *
 * Deliberately does NOT take a userId/threadId or call UsageService itself -
 * each caller already has that request context in scope (summarizer.ts's
 * buildConversationContext, memory.service.ts's rememberFromMessage,
 * graph.ts around its generateFollowUpSuggestions call) and logs the
 * returned usage itself, the same way graph.ts logs the main chat model's
 * usage after streaming finishes. Keeping this function a pure "call a
 * cheap model" primitive - like the main model calls it mirrors - means one
 * consistent place to fix if the usage-reading logic ever needs to change.
 *
 * Falls back to a direct Gemini call ONLY when neither OpenRouter nor
 * OmniRoute is configured (e.g. local dev with just GEMINI_API_KEY set) -
 * the same degrade path these three call sites already had, just
 * centralized instead of triplicated.
 */
export async function callUtilityModel(prompt: string, modelId: string = DEFAULT_UTILITY_MODEL): Promise<UtilityModelResult> {
  if (isOmniRouteConfigured()) {
    const model = createOmniRouteChatModel(modelId, 0);
    const response = await model.invoke([new HumanMessage(prompt)]);
    const text = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    const usage = response.usage_metadata;

    return {
      text,
      model: resolveOmniRouteModel(modelId),
      inputTokens: usage?.input_tokens ?? null,
      outputTokens: usage?.output_tokens ?? null,
    };
  }

  const apiKey = cleanEnvVar(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  if (!apiKey) {
    throw new Error('No LLM gateway configured: set OPENROUTER_API_KEY, OMNIROUTE_API_KEY, or GEMINI_API_KEY.');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const geminiModel = genAI.getGenerativeModel({ model: modelId });
  const result = await geminiModel.generateContent(prompt);
  const usage = result.response.usageMetadata;

  return {
    text: result.response.text(),
    model: modelId,
    inputTokens: usage?.promptTokenCount ?? null,
    outputTokens: usage?.candidatesTokenCount ?? null,
  };
}
