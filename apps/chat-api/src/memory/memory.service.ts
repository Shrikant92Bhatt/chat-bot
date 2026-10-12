import { MemoryEntry } from '@chat-monorepo/shared';
import { query } from '../db/postgres';
import { extractMemoryCandidates } from './extractor';
import { UsageService } from '../services/usage.service';

/** Hard cap per user so retrieval stays a cheap in-process scan. */
const MAX_MEMORIES_PER_USER = 200;
/** How many memories get injected into a single turn's context. */
const DEFAULT_RETRIEVAL_LIMIT = 5;
/** Below this keyword-overlap score a memory is considered irrelevant to the query. */
const RELEVANCE_THRESHOLD = 0.08;

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been', 'to', 'of', 'in',
  'on', 'for', 'with', 'that', 'this', 'it', 'as', 'at', 'by', 'from', 'i', 'my', 'me', 'you',
  'your', 'we', 'they', 'do', 'does', 'did', 'can', 'could', 'would', 'should', 'what', 'how',
  'when', 'where', 'who', 'why', 'user',
]);

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

interface MemoryRow {
  id: string;
  user_id: string;
  content: string;
  kind: MemoryEntry['kind'];
  created_at: number;
  updated_at: number;
  source_thread_id: string | null;
}

function toMemoryEntry(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    userId: row.user_id,
    content: row.content,
    kind: row.kind,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceThreadId: row.source_thread_id,
  };
}

/**
 * Long-term, user-level memory — durable facts and preferences that should
 * survive across conversations.
 *
 * Distinct from the other two context sources:
 *  - RAG (`rag/retriever.ts`) retrieves from *documents the user uploaded*.
 *  - Conversation history/summary is scoped to a *single thread*.
 *  - Memory is small, user-scoped, and cross-thread.
 *
 * Storage: the `memories` table, filtered by a `user_id` column.
 *
 * Every method is best-effort: Postgres being unavailable degrades chat to
 * "no memories injected" rather than failing the turn.
 */
export class MemoryService {
  /** All memories for a user, newest first. */
  static async listMemories(userId: string): Promise<MemoryEntry[]> {
    if (!userId) return [];
    try {
      const rows = await query<MemoryRow>('SELECT * FROM memories WHERE user_id = $1 ORDER BY updated_at DESC', [userId]);
      return rows.map(toMemoryEntry);
    } catch (error) {
      console.error('[MemoryService] Failed to list memories:', error);
      return [];
    }
  }

  /**
   * Returns the memories most relevant to `query`, as plain strings ready
   * for the Prompt Manager's memory block.
   *
   * Scoring is keyword overlap (Jaccard-ish) rather than embeddings — the
   * memory set per user is small (<= 200) and these are short declarative
   * sentences, so lexical overlap is adequate and costs nothing. `instruction`
   * memories ("always answer in Spanish") are always included regardless of
   * score, because they are standing directives, not query-relevant facts.
   */
  static async getRelevantMemories(
    userId: string | undefined,
    query_: string,
    limit = DEFAULT_RETRIEVAL_LIMIT
  ): Promise<string[]> {
    if (!userId) return [];

    const memories = await this.listMemories(userId);
    if (memories.length === 0) return [];

    const queryTokens = new Set(tokenize(query_ || ''));

    const standing = memories.filter((m) => m.kind === 'instruction' || m.kind === 'identity');
    const scored = memories
      .filter((m) => !standing.includes(m))
      .map((m) => {
        const tokens = tokenize(m.content);
        if (tokens.length === 0 || queryTokens.size === 0) return { memory: m, score: 0 };
        const overlap = tokens.filter((t) => queryTokens.has(t)).length;
        return { memory: m, score: overlap / Math.sqrt(tokens.length * queryTokens.size) };
      })
      .filter((s) => s.score > RELEVANCE_THRESHOLD)
      .sort((a, b) => b.score - a.score)
      .map((s) => s.memory);

    return [...standing, ...scored].slice(0, limit).map((m) => m.content);
  }

  /**
   * Extracts memory candidates from one user message and stores anything
   * new. Intended to be called fire-and-forget after a turn completes.
   *
   * Deduplication is exact-ish (normalised lowercase compare) — a repeated
   * "my name is X" updates the existing entry's timestamp instead of
   * creating a duplicate.
   */
  static async rememberFromMessage(
    userId: string | undefined,
    message: string,
    sourceThreadId?: string | null
  ): Promise<MemoryEntry[]> {
    if (!userId || !message?.trim()) return [];

    try {
      const callStartedAt = Date.now();
      const { candidates, usage } = await extractMemoryCandidates(message);

      // Real cost whenever the LLM stage actually ran, regardless of
      // whether it found anything worth keeping - logged the same way
      // graph.ts logs the main chat model's usage.
      if (usage) {
        UsageService.logUsage({
          userId,
          tenantId: null,
          conversationId: sourceThreadId ?? null,
          model: usage.model,
          purpose: 'memory_extraction',
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          latencyMs: Date.now() - callStartedAt,
        }).catch((error) => console.error('[MemoryService] Failed to log usage record:', error));
      }

      if (candidates.length === 0) return [];

      const existing = await this.listMemories(userId);
      if (existing.length >= MAX_MEMORIES_PER_USER) {
        console.warn(`[MemoryService] User ${userId} hit the ${MAX_MEMORIES_PER_USER}-memory cap; skipping new memories.`);
        return [];
      }

      const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
      const existingByContent = new Map(existing.map((m) => [normalise(m.content), m]));

      const written: MemoryEntry[] = [];
      const now = Date.now();

      for (const candidate of candidates) {
        const duplicate = existingByContent.get(normalise(candidate.content));
        if (duplicate) {
          await query('UPDATE memories SET updated_at = $2 WHERE id = $1', [duplicate.id, now]);
          continue;
        }

        const id = `mem-${now}-${Math.random().toString(36).slice(2, 8)}`;
        const entry: MemoryEntry = {
          id,
          userId,
          content: candidate.content,
          kind: candidate.kind,
          createdAt: now,
          updatedAt: now,
          sourceThreadId: sourceThreadId ?? null,
        };
        await query(
          'INSERT INTO memories (id, user_id, content, kind, created_at, updated_at, source_thread_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [entry.id, entry.userId, entry.content, entry.kind, entry.createdAt, entry.updatedAt, entry.sourceThreadId]
        );
        written.push(entry);
      }

      return written;
    } catch (error) {
      console.error('[MemoryService] Failed to store memories:', error);
      return [];
    }
  }

  /**
   * The explicit, user-authored "About you" profile (ChatGPT calls this
   * Custom Instructions) - distinct from the auto-extracted memories above:
   * one fixed row per user rather than a growing list, and it is never
   * written by `rememberFromMessage`, only by the user themselves via the
   * Settings screen. Stored as an ordinary `identity`-kind MemoryEntry with
   * a deterministic id so it's already included unconditionally by
   * `getRelevantMemories`'s "standing" memories path and shows up in
   * `listMemories` like any other entry - no separate storage or retrieval
   * path to keep in sync.
   */
  private static profileId(userId: string): string {
    return `profile-${userId}`;
  }

  static async getProfile(userId: string): Promise<string> {
    if (!userId) return '';
    try {
      const rows = await query<{ content: string }>('SELECT content FROM memories WHERE id = $1', [this.profileId(userId)]);
      return rows[0]?.content || '';
    } catch (error) {
      console.error('[MemoryService] Failed to load profile:', error);
      return '';
    }
  }

  static async setProfile(userId: string, aboutMe: string): Promise<void> {
    if (!userId) return;
    const content = (aboutMe || '').trim().slice(0, 2000);
    const id = this.profileId(userId);
    const now = Date.now();

    try {
      if (!content) {
        await query('DELETE FROM memories WHERE id = $1', [id]);
        return;
      }
      await query(
        `
        INSERT INTO memories (id, user_id, content, kind, created_at, updated_at, source_thread_id)
        VALUES ($1, $2, $3, 'identity', $4, $4, NULL)
        ON CONFLICT (id) DO UPDATE SET content = $3, updated_at = $4
        `,
        [id, userId, content, now]
      );
    } catch (error) {
      console.error('[MemoryService] Failed to save profile:', error);
      throw error;
    }
  }

  static async deleteMemory(userId: string, memoryId: string): Promise<boolean> {
    try {
      const rows = await query<{ user_id: string }>('SELECT user_id FROM memories WHERE id = $1', [memoryId]);
      if (!rows[0] || rows[0].user_id !== userId) return false;
      await query('DELETE FROM memories WHERE id = $1', [memoryId]);
      return true;
    } catch (error) {
      console.error('[MemoryService] Failed to delete memory:', error);
      return false;
    }
  }
}
