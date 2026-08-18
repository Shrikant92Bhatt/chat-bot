import { firestore } from '../db/firestore';

export interface RegisteredUser {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
  lastLogin: number;
}

const usersCollection = () => firestore.collection('users');

export class UserRegistryService {
  /**
   * Automatically records or updates a user profile upon Google OAuth login.
   * Callers (e.g. the access-token auth fallback) may only know uid/email,
   * so a missing name/picture on a partial update falls back to whatever
   * is already stored, rather than overwriting it with a placeholder.
   */
  public static async registerOrUpdateUser(user: {
    uid: string;
    email?: string;
    name?: string;
    picture?: string;
  }): Promise<RegisteredUser> {
    const now = Date.now();
    const defaultPicture = 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + user.uid;
    const docRef = usersCollection().doc(user.uid);

    const existing = await docRef.get();
    const existingData = existing.exists ? (existing.data() as Partial<RegisteredUser>) : undefined;

    const merged: RegisteredUser = {
      uid: user.uid,
      email: user.email ?? existingData?.email ?? 'user@example.com',
      name: user.name ?? existingData?.name ?? 'Authenticated User',
      picture: user.picture ?? existingData?.picture ?? defaultPicture,
      lastLogin: now,
    };

    await docRef.set(merged);
    return merged;
  }

  /**
   * Returns list of all registered application users.
   */
  public static async getAllUsers(): Promise<RegisteredUser[]> {
    const snapshot = await usersCollection().orderBy('lastLogin', 'desc').get();
    return snapshot.docs.map((doc) => doc.data() as RegisteredUser);
  }
}
