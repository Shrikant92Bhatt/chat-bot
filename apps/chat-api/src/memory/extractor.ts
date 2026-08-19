import { GoogleGenerativeAI } from '@google/generative-ai';
import { MemoryKind } from '@chat-monorepo/shared';
import { renderPrompt } from '../prompt/prompt-manager';

export interface MemoryCandidate {
  content: string;
  kind: MemoryKind;
}

/**
 * Cheap regex gate that runs BEFORE any LLM call. The design constraint is
 * "do not store every message" — so extraction is opt-in by shape: a message
 * only becomes a memory candidate if it looks like a first-person statement
 * about the user (identity, employer, location, stable preference) or an
 * explicit "remember this" instruction.
 *
 * Questions are rejected outright, and so are very long messages (a wall of
 * pasted text is a task, not a fact about the user).
 */
const CANDIDATE_PATTERNS: Array<{ pattern: RegExp; kind: MemoryKind }> = [
  { pattern: /\b(?:my name is|i am called|call me|i go by)\b/i, kind: 'identity' },
  { pattern: /\bi(?:'m| am)\s+(?:a|an|the)\s+[a-z]/i, kind: 'identity' },
  { pattern: /\bi (?:work|study)\s+(?:at|for|on|in)\b/i, kind: 'identity' },
  { pattern: /\bi live in\b|\bi'?m based in\b|\bmy timezone is\b/i, kind: 'identity' },
  { pattern: /\b(?:i prefer|i like|i love|i hate|i don'?t like|i'd rather)\b/i, kind: 'preference' },
  { pattern: /\b(?:always|never|from now on|going forward)\b.{0,60}\b(?:answer|reply|respond|use|write|format|explain|call me)\b/i, kind: 'instruction' },
  { pattern: /\b(?:remember(?: that)?|keep in mind|note that|for future reference|don'?t forget)\b/i, kind: 'instruction' },
  { pattern: /\bmy (?:team|company|employer|role|job|stack|setup|project|email|pronouns) (?:is|are)\b/i, kind: 'fact' },
];

const MIN_LENGTH = 8;
const MAX_LENGTH = 600;
const MAX_MEMORY_CHARS = 240;

function cleanEnvVar(val?: string): string {
  if (!val) return '';
  return val.replace(/^﻿/, '').replace(/\r/g, '').trim();
}

/** True when the message is worth spending an extraction call on. */
export function looksMemorable(message: string): { memorable: boolean; kind: MemoryKind } {
  const text = (message || '').trim();

  if (text.length < MIN_LENGTH || text.length > MAX_LENGTH) {
    return { memorable: false, kind: 'fact' };
  }

  // Questions are requests, not statements about the user. An explicit
  // "remember ..." instruction still wins, so check that separately below.
  const isQuestion = /\?\s*$/.test(text) || /^(?:what|who|when|where|why|how|can you|could you|do you|is|are|does)\b/i.test(text);

  for (const { pattern, kind } of CANDIDATE_PATTERNS) {
    if (!pattern.test(text)) continue;
    if (isQuestion && kind !== 'instruction') continue;
    return { memorable: true, kind };
  }

  return { memorable: false, kind: 'fact' };
}

/**
 * Turns a user message into zero or more durable memory candidates.
 *
 * Two stages, both cheap:
 *  1. `looksMemorable()` regex gate — rejects the overwhelming majority of
 *     messages with no network call at all.
 *  2. A single non-streamed Gemini Flash call (same pattern as
 *     suggestions.service.ts) that normalises the sentence into a short
 *     third-person statement and can still veto the candidate.
 *
 * If no Gemini key is configured the LLM stage is skipped and the raw
 * (trimmed) sentence is stored — degraded but functional, never fabricated.
 * Never throws: memory is best-effort and must not break a chat turn.
 */
export async function extractMemoryCandidates(message: string): Promise<MemoryCandidate[]> {
  const gate = looksMemorable(message);
  if (!gate.memorable) return [];

  const trimmed = message.trim();
  const apiKey = cleanEnvVar(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);

  if (!apiKey) {
    return [{ content: trimmed.slice(0, MAX_MEMORY_CHARS), kind: gate.kind }];
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });

    const result = await model.generateContent(renderPrompt('memory_extraction:v1', { message: trimmed }));
    const text = result.response
      .text()
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((c): c is MemoryCandidate => !!c && typeof c.content === 'string' && c.content.trim().length > 0)
      .slice(0, 3)
      .map((c) => ({
        content: c.content.trim().slice(0, MAX_MEMORY_CHARS),
        kind: (['identity', 'preference', 'fact', 'instruction'] as MemoryKind[]).includes(c.kind) ? c.kind : gate.kind,
      }));
  } catch (error) {
    console.error('[MemoryExtractor] LLM extraction failed, falling back to heuristic:', error);
    return [{ content: trimmed.slice(0, MAX_MEMORY_CHARS), kind: gate.kind }];
  }
}
