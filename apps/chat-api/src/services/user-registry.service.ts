import { firestore } from '../db/firestore';

/** Application role. Authorization for the admin analytics app is decided
 *  by a FRESH Firestore read of this field on every request (see
 *  middleware/admin.middleware.ts) - it is deliberately NOT baked into the
 *  7-day session JWT, so a demotion takes effect immediately. */
export type UserRole = 'user' | 'admin';

export interface RegisteredUser {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
  /** Optional because documents written before the role migration
   *  (scripts/migrate-add-user-roles.ts) may predate the field; any user
   *  without an explicit role is treated as 'user'. */
  role?: UserRole;
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
      // Only DEFAULT a role - never overwrite one that's already stored.
      // An admin signing in must stay an admin; this write happens on every
      // single login, so clobbering here would silently self-demote them.
      role: existingData?.role ?? 'user',
      lastLogin: now,
    };

    await docRef.set(merged);
    return merged;
  }

  /**
   * Returns list of all registered application users, including their role
   * (users stored before the role migration read back as 'user').
   */
  public static async getAllUsers(): Promise<RegisteredUser[]> {
    const snapshot = await usersCollection().orderBy('lastLogin', 'desc').get();
    return snapshot.docs.map((doc) => {
      const data = doc.data() as RegisteredUser;
      return { ...data, uid: data.uid ?? doc.id, role: data.role ?? 'user' };
    });
  }

  /**
   * Reads the CURRENT role straight from Firestore. Used by requireAdmin on
   * every admin request rather than trusting a claim in the long-lived JWT.
   */
  public static async getUserRole(uid: string): Promise<UserRole> {
    const doc = await usersCollection().doc(uid).get();
    if (!doc.exists) return 'user';
    const role = (doc.data() as RegisteredUser | undefined)?.role;
    return role === 'admin' ? 'admin' : 'user';
  }

  /** Number of users currently holding the admin role. */
  public static async countAdmins(): Promise<number> {
    const snapshot = await usersCollection().where('role', '==', 'admin').get();
    return snapshot.size;
  }

  /**
   * Sets a user's role. Returns null when the user doesn't exist, so the
   * caller can 404 rather than creating a phantom user document.
   */
  public static async setUserRole(uid: string, role: UserRole): Promise<RegisteredUser | null> {
    const docRef = usersCollection().doc(uid);
    const doc = await docRef.get();
    if (!doc.exists) return null;

    await docRef.set({ role }, { merge: true });
    const data = doc.data() as RegisteredUser;
    return { ...data, uid: data.uid ?? doc.id, role };
  }
}
