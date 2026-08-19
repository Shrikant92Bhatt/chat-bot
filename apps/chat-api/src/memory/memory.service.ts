import { MemoryEntry } from '@chat-monorepo/shared';
import { firestore } from '../db/firestore';
import { extractMemoryCandidates } from './extractor';

const MEMORIES_COLLECTION = 'memories';

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

/**
 * Long-term, user-level memory — durable facts and preferences that should
 * survive across conversations.
 *
 * Distinct from the other two context sources:
 *  - RAG (`rag/retriever.ts`) retrieves from *documents the user uploaded*.
 *  - Conversation history/summary is scoped to a *single thread*.
 *  - Memory is small, user-scoped, and cross-thread.
 *
 * Storage: top-level Firestore `memories` collection, one doc per memory,
 * filtered by a `userId` field. Deliberately a single-field `where` query
 * (sorting/scoring happen in process) so it needs no composite index.
 *
 * Every method is best-effort: Firestore being unavailable degrades chat to
 * "no memories injected" rather than failing the turn.
 */
export class MemoryService {
  private static collection() {
    return firestore.collection(MEMORIES_COLLECTION);
  }

  /** All memories for a user, newest first. */
  static async listMemories(userId: string): Promise<MemoryEntry[]> {
    if (!userId) return [];
    try {
      const snapshot = await this.collection().where('userId', '==', userId).get();
      return snapshot.docs
        .map((doc) => doc.data() as MemoryEntry)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
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
    query: string,
    limit = DEFAULT_RETRIEVAL_LIMIT
  ): Promise<string[]> {
    if (!userId) return [];

    const memories = await this.listMemories(userId);
    if (memories.length === 0) return [];

    const queryTokens = new Set(tokenize(query || ''));

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
      const candidates = await extractMemoryCandidates(message);
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
          await this.collection().doc(duplicate.id).set({ ...duplicate, updatedAt: now }, { merge: true });
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
        await this.collection().doc(id).set(entry);
        written.push(entry);
      }

      return written;
    } catch (error) {
      console.error('[MemoryService] Failed to store memories:', error);
      return [];
    }
  }

  static async deleteMemory(userId: string, memoryId: string): Promise<boolean> {
    try {
      const docRef = this.collection().doc(memoryId);
      const snapshot = await docRef.get();
      if (!snapshot.exists || (snapshot.data() as MemoryEntry).userId !== userId) {
        return false;
      }
      await docRef.delete();
      return true;
    } catch (error) {
      console.error('[MemoryService] Failed to delete memory:', error);
      return false;
    }
  }
}
