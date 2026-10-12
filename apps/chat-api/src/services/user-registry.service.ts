import { query } from '../db/postgres';

/** Application role. Authorization for the admin analytics app is decided
 *  by a FRESH Postgres read of this field on every request (see
 *  middleware/admin.middleware.ts) - it is deliberately NOT baked into the
 *  7-day session JWT, so a demotion takes effect immediately. */
export type UserRole = 'user' | 'admin';

export interface RegisteredUser {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
  role?: UserRole;
  lastLogin: number;
}

interface UserRow {
  uid: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  role: UserRole;
  last_login: number;
}

function toRegisteredUser(row: UserRow): RegisteredUser {
  return {
    uid: row.uid,
    email: row.email ?? undefined,
    name: row.name ?? undefined,
    picture: row.picture ?? undefined,
    role: row.role,
    lastLogin: row.last_login,
  };
}

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

    // One round trip: INSERT a brand new row with the given/default values,
    // or on conflict UPDATE - COALESCE-ing each field against the row that's
    // already there so a partial update never clobbers a value the caller
    // didn't supply. `role` is deliberately excluded from the UPDATE SET
    // list entirely (not even COALESCE'd) - this runs on every login, and
    // an admin signing in must stay an admin, so the column simply isn't
    // touched by this statement at all, same as the Firestore version
    // reading existingData.role first and re-writing the same value back.
    const rows = await query<UserRow>(
      `
      INSERT INTO users (uid, email, name, picture, role, last_login)
      VALUES ($1, $2, $3, $4, 'user', $5)
      ON CONFLICT (uid) DO UPDATE SET
        email = COALESCE($2, users.email),
        name = COALESCE($3, users.name),
        picture = COALESCE($4, users.picture),
        last_login = $5
      RETURNING uid, email, name, picture, role, last_login
      `,
      [user.uid, user.email ?? null, user.name ?? null, user.picture ?? defaultPicture, now]
    );

    return toRegisteredUser(rows[0]);
  }

  /**
   * Returns list of all registered application users, including their role.
   */
  public static async getAllUsers(): Promise<RegisteredUser[]> {
    const rows = await query<UserRow>('SELECT uid, email, name, picture, role, last_login FROM users ORDER BY last_login DESC');
    return rows.map(toRegisteredUser);
  }

  /**
   * Reads the CURRENT role straight from Postgres. Used by requireAdmin on
   * every admin request rather than trusting a claim in the long-lived JWT.
   */
  public static async getUserRole(uid: string): Promise<UserRole> {
    const rows = await query<{ role: UserRole }>('SELECT role FROM users WHERE uid = $1', [uid]);
    return rows[0]?.role === 'admin' ? 'admin' : 'user';
  }

  /** Number of users currently holding the admin role. */
  public static async countAdmins(): Promise<number> {
    const rows = await query<{ count: number }>("SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin'");
    return rows[0]?.count ?? 0;
  }

  /**
   * Sets a user's role. Returns null when the user doesn't exist, so the
   * caller can 404 rather than creating a phantom user row.
   */
  public static async setUserRole(uid: string, role: UserRole): Promise<RegisteredUser | null> {
    const rows = await query<UserRow>(
      'UPDATE users SET role = $2 WHERE uid = $1 RETURNING uid, email, name, picture, role, last_login',
      [uid, role]
    );
    return rows[0] ? toRegisteredUser(rows[0]) : null;
  }
}
