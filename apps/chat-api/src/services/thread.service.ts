import { ChatThread } from '@chat-monorepo/shared';
import { query } from '../db/postgres';

interface ThreadRow {
  data: ChatThread;
}

export class ThreadService {
  /**
   * Blank threads (no user message yet - just a fresh "New Chat" the user
   * never typed into) used to get persisted as a side effect of the client
   * saving its whole in-memory thread list on every send, compounding on
   * every reload. Filtered out here too, not just client-side, so a future
   * client bug (or a different client) can't reintroduce visible clutter -
   * the rows themselves are left alone (no delete-thread feature exists),
   * this just stops surfacing ones that predate the client-side fix.
   */
  private static hasUserMessage(thread: ChatThread): boolean {
    return (thread.messages || []).some((m) => m.role === 'user');
  }

  public static async getThreadsForUser(uid: string): Promise<ChatThread[]> {
    const rows = await query<ThreadRow>('SELECT data FROM threads WHERE uid = $1 ORDER BY updated_at DESC', [uid]);
    return rows.map((r) => r.data).filter((t) => this.hasUserMessage(t));
  }

  /**
   * Returns the thread if it exists AND belongs to `uid` - null for both
   * "doesn't exist" and "belongs to someone else", same as
   * ProjectService.getProject. Unlike projects (a table filtered by an
   * `owner_id` column), threads are keyed by (uid, id) directly, so
   * existence under the CALLER's own uid already IS the ownership check -
   * there's no separate owner column to compare. Used by routes that touch
   * a single thread by id (feedback, below) so a thread id belonging to
   * another user 404s rather than 403s (see AGENTS.md §2b) - it's
   * indistinguishable from a nonexistent id.
   */
  public static async getThread(uid: string, threadId: string): Promise<ChatThread | null> {
    if (!threadId) return null;
    const rows = await query<ThreadRow>('SELECT data FROM threads WHERE uid = $1 AND id = $2', [uid, threadId]);
    return rows[0]?.data ?? null;
  }

  /**
   * Upserts each thread the client sends. Deliberately NOT a delete-then-
   * write replace: a client that sends an incomplete array (e.g. after a
   * failed history load) must never be able to erase threads it doesn't
   * know about. There is no delete-thread feature, so nothing needs the
   * old destructive-replace behavior.
   *
   * `data = threads.data || $2::jsonb` is a shallow top-level JSON merge -
   * the same semantics as Firestore's `set(thread, { merge: true })` this
   * replaces: a server-written field the client doesn't carry (e.g. an
   * older client missing the `summary`/`summarizedThroughIndex` keys
   * entirely) survives, while every key actually present in `thread`
   * overwrites.
   *
   * Writes each thread independently (Promise.allSettled) instead of one
   * atomic multi-row transaction - this used to be an all-or-nothing batch
   * of the caller's *entire* thread list on every turn - one oversized or
   * otherwise rejected row anywhere in that batch failed the whole write,
   * silently blocking even a brand new one-line reply from persisting.
   * Failing independently means a bad row can only ever block itself.
   */
  public static async saveThreadsForUser(uid: string, threads: ChatThread[]): Promise<void> {
    threads = threads.filter((t) => this.hasUserMessage(t));

    const results = await Promise.allSettled(
      threads.map((thread) =>
        query(
          `
          INSERT INTO threads (uid, id, data, updated_at)
          VALUES ($1, $2, $3::jsonb, $4)
          ON CONFLICT (uid, id) DO UPDATE SET
            data = threads.data || $3::jsonb,
            updated_at = $4
          `,
          [uid, thread.id, JSON.stringify(thread), thread.updatedAt ?? Date.now()]
        )
      )
    );

    const failures = results
      .map((result, i) => (result.status === 'rejected' ? { threadId: threads[i].id, reason: result.reason } : null))
      .filter((f): f is { threadId: string; reason: unknown } => f !== null);

    if (failures.length > 0) {
      failures.forEach((f) => console.error(`[ThreadService] Failed to save thread ${f.threadId}:`, f.reason));
      // Only throw (surfacing threadSaveError to the user) when every write
      // failed - a partial failure among a batch of several threads still
      // means most of the caller's data landed, which is strictly better
      // than losing all of it over one bad row.
      if (failures.length === results.length) {
        const first = failures[0].reason;
        throw first instanceof Error ? first : new Error(String(first));
      }
    }
  }

  /**
   * Reads the rolling conversation summary written by SummarizationService.
   * Returns null when the thread doesn't exist yet (the client only persists
   * a thread after its first message) or Postgres is unreachable.
   */
  public static async getThreadSummary(
    uid: string,
    threadId: string
  ): Promise<{ summary: string; summarizedThroughIndex: number } | null> {
    try {
      const rows = await query<ThreadRow>('SELECT data FROM threads WHERE uid = $1 AND id = $2', [uid, threadId]);
      const data = rows[0]?.data;
      if (!data?.summary) return null;
      return { summary: data.summary, summarizedThroughIndex: data.summarizedThroughIndex ?? 0 };
    } catch (error) {
      console.error('[ThreadService] Failed to read thread summary:', error);
      return null;
    }
  }

  /**
   * Persists a rolling summary onto the thread row. Best-effort: a failure
   * here only means the summary gets recomputed later, so it must never
   * break the chat turn that produced it.
   */
  public static async saveThreadSummary(
    uid: string,
    threadId: string,
    summary: string,
    summarizedThroughIndex: number
  ): Promise<void> {
    try {
      const patch = { id: threadId, summary, summarizedThroughIndex, summaryUpdatedAt: Date.now() };
      await query(
        `
        INSERT INTO threads (uid, id, data, updated_at)
        VALUES ($1, $2, $3::jsonb, $4)
        ON CONFLICT (uid, id) DO UPDATE SET
          data = threads.data || $3::jsonb,
          updated_at = $4
        `,
        [uid, threadId, JSON.stringify(patch), patch.summaryUpdatedAt]
      );
    } catch (error) {
      console.error('[ThreadService] Failed to save thread summary:', error);
    }
  }
}
