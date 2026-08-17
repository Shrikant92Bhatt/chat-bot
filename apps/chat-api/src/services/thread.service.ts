import { ChatThread } from '@chat-monorepo/shared';
import { pool } from '../db/pool';

export class ThreadService {
  public static async getThreadsForUser(uid: string): Promise<ChatThread[]> {
    const result = await pool.query(
      `SELECT id, title, model, created_at, updated_at, messages
       FROM chat_threads WHERE user_uid = $1 ORDER BY updated_at DESC`,
      [uid]
    );

    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      model: row.model,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      messages: row.messages,
    }));
  }

  /**
   * Replaces the full thread list for a user in one transaction, mirroring
   * the "save the whole array" pattern the frontend already uses.
   */
  public static async saveThreadsForUser(uid: string, threads: ChatThread[]): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM chat_threads WHERE user_uid = $1', [uid]);

      for (const thread of threads) {
        await client.query(
          `INSERT INTO chat_threads (id, user_uid, title, model, created_at, updated_at, messages)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            thread.id,
            uid,
            thread.title,
            thread.model,
            thread.createdAt,
            thread.updatedAt,
            JSON.stringify(thread.messages),
          ]
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
