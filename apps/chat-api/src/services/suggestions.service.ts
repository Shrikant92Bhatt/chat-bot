import { GoogleGenerativeAI } from '@google/generative-ai';

function cleanEnvVar(val?: string): string {
  if (!val) return '';
  return val.replace(/^﻿/, '').replace(/\r/g, '').trim();
}

/**
 * Best-effort follow-up question suggestions, generated via a single
 * lightweight non-streamed Gemini call after the main response finishes -
 * regardless of which model actually answered. Never throws: any failure
 * (missing key, bad JSON, network error) just means no suggestions, since
 * this must never break the main chat response.
 */
export async function generateFollowUpSuggestions(
  messages: Array<{ role: string; content: string }>,
  assistantReply: string
): Promise<string[]> {
  const apiKey = cleanEnvVar(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  if (!apiKey || !assistantReply.trim()) return [];

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });

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

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();

    // The model sometimes wraps the array in a ```json fence despite instructions.
    const jsonText = text
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).slice(0, 3);
  } catch (error) {
    console.error('[SuggestionsService] Failed to generate follow-up suggestions:', error);
    return [];
  }
}
