import { MessageFeedbackRating, ThreadFeedbackMap } from '@chat-monorepo/shared';
import { query } from '../db/postgres';

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
 * Storage: the `message_feedback` table, primary key
 * (user_id, thread_id, message_id) - a natural idempotency key, so
 * resubmitting or changing a rating overwrites the same row in place
 * instead of accumulating duplicates, and the common single-message
 * read/write path (setRating) is PK-addressed - no query needed at all.
 * Reading every rated message in a thread (getFeedbackForThread) queries by
 * `thread_id`, then filters to the caller's own rows in process (matches
 * the MemoryService/ProjectService pattern).
 */
export class MessageFeedbackService {
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
    if (rating === null) {
      await query('DELETE FROM message_feedback WHERE user_id = $1 AND thread_id = $2 AND message_id = $3', [
        userId,
        threadId,
        messageId,
      ]);
      return;
    }

    await query(
      `
      INSERT INTO message_feedback (user_id, thread_id, message_id, rating, updated_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id, thread_id, message_id) DO UPDATE SET rating = $4, updated_at = $5
      `,
      [userId, threadId, messageId, rating, Date.now()]
    );
  }

  /** { messageId: rating } for every message in this thread the caller has rated. */
  public static async getFeedbackForThread(userId: string, threadId: string): Promise<ThreadFeedbackMap> {
    const rows = await query<{ message_id: string; rating: MessageFeedbackRating }>(
      'SELECT message_id, rating FROM message_feedback WHERE thread_id = $1 AND user_id = $2',
      [threadId, userId]
    );
    const result: ThreadFeedbackMap = {};
    rows.forEach((row) => {
      result[row.message_id] = row.rating;
    });
    return result;
  }
}
