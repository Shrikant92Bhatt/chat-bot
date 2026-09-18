import { MemoryKind } from '@chat-monorepo/shared';
import { renderPrompt } from '../prompt/prompt-manager';
import { callUtilityModel, UtilityModelResult } from '../llm/utility-model';

export interface MemoryCandidate {
  content: string;
  kind: MemoryKind;
}

export interface ExtractMemoryResult {
  candidates: MemoryCandidate[];
  /** Null when the LLM stage never ran - the regex gate rejected the
   *  message, or no gateway/key is configured and the raw-sentence fallback
   *  was used instead. Only a real LLM call has real cost to log. */
  usage: Pick<UtilityModelResult, 'model' | 'inputTokens' | 'outputTokens'> | null;
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
 *  2. A single non-streamed cheap-model call (see llm/utility-model.ts,
 *     same shared path as suggestions.service.ts and summarizer.ts) that
 *     normalises the sentence into a short third-person statement and can
 *     still veto the candidate.
 *
 * If no gateway/key is configured at all the LLM stage is skipped and the
 * raw (trimmed) sentence is stored — degraded but functional, never
 * fabricated. Never throws: memory is best-effort and must not break a chat
 * turn. The caller (memory.service.ts's rememberFromMessage) logs `usage`
 * when non-null - this function has no userId/threadId to log it itself.
 */
export async function extractMemoryCandidates(message: string): Promise<ExtractMemoryResult> {
  const gate = looksMemorable(message);
  if (!gate.memorable) return { candidates: [], usage: null };

  const trimmed = message.trim();

  try {
    const { text, model, inputTokens, outputTokens } = await callUtilityModel(
      renderPrompt('memory_extraction:v1', { message: trimmed })
    );
    const cleaned = text
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    const usage = { model, inputTokens, outputTokens };
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return { candidates: [], usage };

    const candidates = parsed
      .filter((c): c is MemoryCandidate => !!c && typeof c.content === 'string' && c.content.trim().length > 0)
      .slice(0, 3)
      .map((c) => ({
        content: c.content.trim().slice(0, MAX_MEMORY_CHARS),
        kind: (['identity', 'preference', 'fact', 'instruction'] as MemoryKind[]).includes(c.kind) ? c.kind : gate.kind,
      }));

    return { candidates, usage };
  } catch (error) {
    console.error('[MemoryExtractor] LLM extraction failed, falling back to heuristic:', error);
    return { candidates: [{ content: trimmed.slice(0, MAX_MEMORY_CHARS), kind: gate.kind }], usage: null };
  }
}
