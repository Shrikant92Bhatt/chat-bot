import { ChatThread } from '@chat-monorepo/shared';
import { firestore } from '../db/firestore';

export class ThreadService {
  private static threadsCollection(uid: string) {
    return firestore.collection('users').doc(uid).collection('threads');
  }

  /**
   * Blank threads (no user message yet - just a fresh "New Chat" the user
   * never typed into) used to get persisted as a side effect of the client
   * saving its whole in-memory thread list on every send, compounding on
   * every reload. Filtered out here too, not just client-side, so a future
   * client bug (or a different client) can't reintroduce visible clutter -
   * the docs themselves are left alone (no delete-thread feature exists),
   * this just stops surfacing ones that predate the client-side fix.
   */
  private static hasUserMessage(thread: ChatThread): boolean {
    return (thread.messages || []).some((m) => m.role === 'user');
  }

  public static async getThreadsForUser(uid: string): Promise<ChatThread[]> {
    const snapshot = await this.threadsCollection(uid).orderBy('updatedAt', 'desc').get();
    return snapshot.docs.map((doc) => doc.data() as ChatThread).filter((t) => this.hasUserMessage(t));
  }

  /**
   * Returns the thread if it exists AND belongs to `uid` - null for both
   * "doesn't exist" and "belongs to someone else", same as
   * ProjectService.getProject. Unlike projects (a top-level collection
   * filtered by an `ownerId` field), threads live under
   * `users/{uid}/threads`, so existence under the CALLER's own subcollection
   * path already IS the ownership check - there's no separate owner field
   * to compare. Used by routes that touch a single thread by id (feedback,
   * below) so a thread id belonging to another user 404s rather than 403s
   * (see AGENTS.md §2b) - it's indistinguishable from a nonexistent id.
   */
  public static async getThread(uid: string, threadId: string): Promise<ChatThread | null> {
    if (!threadId) return null;
    const snapshot = await this.threadsCollection(uid).doc(threadId).get();
    if (!snapshot.exists) return null;
    return snapshot.data() as ChatThread;
  }

  /**
   * Upserts each thread the client sends. Deliberately NOT a delete-then-
   * write replace: a client that sends an incomplete array (e.g. after a
   * failed history load) must never be able to erase threads it doesn't
   * know about. There is no delete-thread feature, so nothing needs the
   * old destructive-replace behavior.
   */
  public static async saveThreadsForUser(uid: string, threads: ChatThread[]): Promise<void> {
    const collection = this.threadsCollection(uid);
    const batch = firestore.batch();
    threads = threads.filter((t) => this.hasUserMessage(t));
    // merge:true so the server-written summarization fields (summary,
    // summarizedThroughIndex) survive a client save — the client round-trips
    // them, but an older client that doesn't know about them must not wipe them.
    threads.forEach((thread) => batch.set(collection.doc(thread.id), thread, { merge: true }));
    await batch.commit();
  }

  /**
   * Reads the rolling conversation summary written by SummarizationService.
   * Returns null when the thread doesn't exist yet (the client only persists
   * a thread after its first message) or Firestore is unreachable.
   */
  public static async getThreadSummary(
    uid: string,
    threadId: string
  ): Promise<{ summary: string; summarizedThroughIndex: number } | null> {
    try {
      const snapshot = await this.threadsCollection(uid).doc(threadId).get();
      if (!snapshot.exists) return null;
      const data = snapshot.data() as ChatThread;
      if (!data?.summary) return null;
      return { summary: data.summary, summarizedThroughIndex: data.summarizedThroughIndex ?? 0 };
    } catch (error) {
      console.error('[ThreadService] Failed to read thread summary:', error);
      return null;
    }
  }

  /**
   * Persists a rolling summary onto the thread document. Best-effort: a
   * failure here only means the summary gets recomputed later, so it must
   * never break the chat turn that produced it.
   */
  public static async saveThreadSummary(
    uid: string,
    threadId: string,
    summary: string,
    summarizedThroughIndex: number
  ): Promise<void> {
    try {
      await this.threadsCollection(uid)
        .doc(threadId)
        .set({ id: threadId, summary, summarizedThroughIndex, summaryUpdatedAt: Date.now() }, { merge: true });
    } catch (error) {
      console.error('[ThreadService] Failed to save thread summary:', error);
    }
  }
}
