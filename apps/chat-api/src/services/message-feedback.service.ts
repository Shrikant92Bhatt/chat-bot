import { MessageFeedbackRating, ThreadFeedbackMap } from '@chat-monorepo/shared';
import { firestore } from '../db/firestore';

/**
 * Thumbs up/down feedback on individual assistant messages.
 *
 * Design decision: deliberately NOT correlated to usage.service.ts's
 * `requestId`. That id is generated server-side per LLM call and is never
 * sent back to the client - the final SSE `res.write` in
 * orchestration/graph.ts's streamGraphResponse carries
 * `{ chunk, done, model, suggestions, ui?, sources?, modelSwitch? }`, no
 * request/usage id - so there is no existing link to a client-side
 * ChatMessage to reuse. Threading an internal backend id through the SSE
 * response just to make that correlation possible would be new plumbing
 * for a feature that doesn't need it: the client already knows exactly
 * which conversation and which message it's rating. The simpler, robust
 * key is what the caller already has and what the server can independently
 * verify: { userId (from the verified session token, never client-supplied),
 * threadId, messageId }.
 *
 * Firestore layout: a single top-level `messageFeedback` collection, doc id
 * `${uid}_${threadId}_${messageId}` - a natural idempotency key, so
 * resubmitting or changing a rating overwrites the same doc in place
 * instead of accumulating duplicates, and the common single-message
 * read/write path (setRating) is doc-id addressed - no query needed at all.
 * Reading every rated message in a thread (getFeedbackForThread) uses a
 * single-field `where('threadId', '==', ...)` query per the Firestore query
 * rules (AGENTS.md §2b - no composite index), then filters to the caller's
 * own rows in process (matches the MemoryService/ProjectService pattern).
 */
export class MessageFeedbackService {
  private static collection() {
    return firestore.collection('messageFeedback');
  }

  /** Firestore doc ids can't contain "/" - none of this app's client-generated
   *  thread/message ids (`thread-<ts>`, `msg-<ts>`, `msg-ai-<ts>`) should ever
   *  have one, but stripped defensively rather than letting a stray value throw. */
  private static docId(userId: string, threadId: string, messageId: string): string {
    const clean = (value: string) => value.replace(/\//g, '_');
    return `${clean(userId)}_${clean(threadId)}_${clean(messageId)}`;
  }

  /**
   * Sets, changes, or clears (`rating === null`) the caller's rating on one
   * message. Callers must verify ownership of `threadId` themselves before
   * calling this (see routes/chat.routes.ts) - this method trusts its
   * `userId` argument completely, so it must only ever be passed the
   * verified session uid, never anything client-supplied.
   */
  public static async setRating(
    userId: string,
    threadId: string,
    messageId: string,
    rating: MessageFeedbackRating | null
  ): Promise<void> {
    const ref = this.collection().doc(this.docId(userId, threadId, messageId));
    if (rating === null) {
      await ref.delete();
      return;
    }
    await ref.set({ userId, threadId, messageId, rating, updatedAt: Date.now() });
  }

  /** { messageId: rating } for every message in this thread the caller has rated. */
  public static async getFeedbackForThread(userId: string, threadId: string): Promise<ThreadFeedbackMap> {
    const snapshot = await this.collection().where('threadId', '==', threadId).get();
    const result: ThreadFeedbackMap = {};
    snapshot.docs.forEach((doc) => {
      const data = doc.data() as { userId: string; messageId: string; rating: MessageFeedbackRating };
      if (data.userId === userId) {
        result[data.messageId] = data.rating;
      }
    });
    return result;
  }
}
