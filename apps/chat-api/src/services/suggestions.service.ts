import { callUtilityModel, UtilityModelResult } from '../llm/utility-model';

export interface FollowUpSuggestionsResult {
  suggestions: string[];
  /** Null when nothing was actually called (empty reply) or the call failed. */
  usage: Pick<UtilityModelResult, 'model' | 'inputTokens' | 'outputTokens'> | null;
}

/**
 * Best-effort follow-up question suggestions, generated via a single
 * lightweight non-streamed cheap-model call (see llm/utility-model.ts) after
 * the main response finishes - regardless of which model actually answered.
 * Never throws: any failure (no gateway/key, bad JSON, network error) just
 * means no suggestions, since this must never break the main chat response.
 * Callers log `usage` themselves (see orchestration/graph.ts) - this
 * function has no userId/threadId to log it with.
 */
export async function generateFollowUpSuggestions(
  messages: Array<{ role: string; content: string }>,
  assistantReply: string
): Promise<FollowUpSuggestionsResult> {
  if (!assistantReply.trim()) return { suggestions: [], usage: null };

  try {
    // Keep the prompt small - only recent context is needed for follow-ups.
    const transcript = [...messages, { role: 'assistant', content: assistantReply }]
      .slice(-6)
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n');

    const prompt =
      'Based on this conversation, suggest exactly 3 short, natural follow-up questions ' +
      'the user might ask next. Return ONLY a JSON array of 3 strings, no other text, ' +
      'no markdown formatting.\n\n' +
      transcript;

    const { text, model, inputTokens, outputTokens } = await callUtilityModel(prompt);
    const usage = { model, inputTokens, outputTokens };

    // The model sometimes wraps the array in a ```json fence despite instructions.
    const jsonText = text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) return { suggestions: [], usage };

    const suggestions = parsed.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 3);
    return { suggestions, usage };
  } catch (error) {
    console.error('[SuggestionsService] Failed to generate follow-up suggestions:', error);
    return { suggestions: [], usage: null };
  }
}
