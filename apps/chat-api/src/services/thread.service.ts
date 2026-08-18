import { ChatThread } from '@chat-monorepo/shared';
import { firestore } from '../db/firestore';

export class ThreadService {
  private static threadsCollection(uid: string) {
    return firestore.collection('users').doc(uid).collection('threads');
  }

  public static async getThreadsForUser(uid: string): Promise<ChatThread[]> {
    const snapshot = await this.threadsCollection(uid).orderBy('updatedAt', 'desc').get();
    return snapshot.docs.map((doc) => doc.data() as ChatThread);
  }

  /**
   * Replaces the full thread list for a user in one batch, mirroring the
   * "save the whole array" pattern the frontend already uses.
   */
  public static async saveThreadsForUser(uid: string, threads: ChatThread[]): Promise<void> {
    const collection = this.threadsCollection(uid);
    const existingSnapshot = await collection.get();

    const batch = firestore.batch();
    existingSnapshot.docs.forEach((doc) => batch.delete(doc.ref));
    threads.forEach((thread) => batch.set(collection.doc(thread.id), thread));

    await batch.commit();
  }
}
