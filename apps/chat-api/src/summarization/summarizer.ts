import { GoogleGenerativeAI } from '@google/generative-ai';
import { MessageRole } from '@chat-monorepo/shared';
import { estimateTokens, renderPrompt } from '../prompt/prompt-manager';
import { ThreadService } from '../services/thread.service';

export interface SimpleMessage {
  role: MessageRole;
  content: string;
}

export interface ConversationContext {
  /** Rolling summary of the turns that were dropped, or null when the whole history fits. */
  summary: string | null;
  /** The messages that should actually be sent to the model this turn. */
  recentMessages: SimpleMessage[];
  /** True when this turn triggered a (re)summarization. */
  summarized: boolean;
}

/**
 * Trigger thresholds. Summarization kicks in when EITHER is crossed, so a
 * few very long messages compress just like many short ones.
 */
const MESSAGE_COUNT_THRESHOLD = 20;
const TOKEN_BUDGET = 6000;
/** Turns always kept verbatim at the tail of the window. */
const KEEP_RECENT_MESSAGES = 8;

function cleanEnvVar(val?: string): string {
  if (!val) return '';
  return val.replace(/^﻿/, '').replace(/\r/g, '').trim();
}

function estimateHistoryTokens(messages: SimpleMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content || ''), 0);
}

function toTranscript(messages: SimpleMessage[]): string {
  return messages.map((m) => `${m.role}: ${m.content}`).join('\n\n');
}

/**
 * Process-level cache of summaries, keyed by user+thread. Covers the two
 * cases where Firestore can't be the source of truth: anonymous/trial users
 * (no uid) and clients that don't send a threadId. Bounded so a long-running
 * process can't grow it without limit.
 */
const summaryCache = new Map<string, { summary: string; throughIndex: number }>();
const MAX_CACHE_ENTRIES = 500;

function cacheKey(uid: string | undefined, threadId: string | undefined): string {
  return `${uid || 'anon'}:${threadId || 'no-thread'}`;
}

function readCache(key: string) {
  return summaryCache.get(key) ?? null;
}

function writeCache(key: string, value: { summary: string; throughIndex: number }) {
  if (summaryCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = summaryCache.keys().next().value;
    if (oldest) summaryCache.delete(oldest);
  }
  summaryCache.set(key, value);
}

/**
 * Runs the summarization prompt. Uses a single non-streamed Gemini Flash
 * call (the same cheap-side-call pattern as suggestions.service.ts) so the
 * cost of compressing history never depends on which model is answering.
 * Returns null on any failure — the caller then falls back to sending the
 * full history, which is correct if expensive.
 */
async function summarize(previousSummary: string | null, olderMessages: SimpleMessage[]): Promise<string | null> {
  const apiKey = cleanEnvVar(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  if (!apiKey || olderMessages.length === 0) return null;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });

    const prompt = renderPrompt('summarization:v1', {
      previousSummary: previousSummary || '(none)',
      transcript: toTranscript(olderMessages),
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    return text || null;
  } catch (error) {
    console.error('[Summarizer] Failed to summarize conversation:', error);
    return null;
  }
}

export class SummarizationService {
  /**
   * Decides how much of the conversation to send this turn.
   *
   * Below the threshold, the full history goes through untouched. Above it,
   * everything except the last KEEP_RECENT_MESSAGES turns is folded into a
   * rolling summary (incrementally — a previously stored summary is fed back
   * in rather than re-summarizing from scratch), and only
   * `summary + recent turns` is sent.
   *
   * The summary is persisted onto the thread document in Firestore when a
   * uid + threadId are available, and always mirrored into a process-level
   * cache so anonymous/threadless sessions don't pay for a fresh
   * summarization call on every message.
   */
  static async buildConversationContext(params: {
    uid?: string;
    threadId?: string;
    messages: SimpleMessage[];
  }): Promise<ConversationContext> {
    const { uid, threadId, messages } = params;
    const history = messages || [];

    const overCount = history.length > MESSAGE_COUNT_THRESHOLD;
    const overTokens = estimateHistoryTokens(history) > TOKEN_BUDGET;

    if (!overCount && !overTokens) {
      return { summary: null, recentMessages: history, summarized: false };
    }

    const splitIndex = Math.max(0, history.length - KEEP_RECENT_MESSAGES);
    const older = history.slice(0, splitIndex);
    const recent = history.slice(splitIndex);

    const key = cacheKey(uid, threadId);
    let stored = readCache(key);

    if (!stored && uid && threadId) {
      const persisted = await ThreadService.getThreadSummary(uid, threadId);
      if (persisted?.summary) {
        stored = { summary: persisted.summary, throughIndex: persisted.summarizedThroughIndex ?? 0 };
        writeCache(key, stored);
      }
    }

    // Already covers everything we were going to drop — reuse it as-is.
    if (stored && stored.throughIndex >= splitIndex) {
      return { summary: stored.summary, recentMessages: recent, summarized: false };
    }

    const previousSummary = stored?.summary ?? null;
    const newlyDropped = older.slice(stored?.throughIndex ?? 0);

    const summary = await summarize(previousSummary, newlyDropped);

    if (!summary) {
      // Summarization unavailable (no Gemini key, or the call failed).
      // Send the full history rather than silently amputating context.
      return { summary: previousSummary, recentMessages: previousSummary ? recent : history, summarized: false };
    }

    writeCache(key, { summary, throughIndex: splitIndex });

    if (uid && threadId) {
      await ThreadService.saveThreadSummary(uid, threadId, summary, splitIndex);
    }

    return { summary, recentMessages: recent, summarized: true };
  }
}
