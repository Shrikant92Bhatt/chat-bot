import { pool } from '../db/pool';

export interface RegisteredUser {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
  lastLogin: number;
}

export class UserRegistryService {
  /**
   * Automatically records or updates a user profile upon Google OAuth login.
   */
  public static async registerOrUpdateUser(user: {
    uid: string;
    email?: string;
    name?: string;
    picture?: string;
  }): Promise<RegisteredUser> {
    const now = Date.now();
    const defaultPicture = 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + user.uid;

    // Callers (e.g. the access-token auth fallback) may only know uid/email
    // and pass name/picture as undefined — those must stay NULL going into
    // the query so COALESCE preserves the existing row on conflict, rather
    // than baking in a placeholder default that then wins on every update.
    const result = await pool.query(
      `INSERT INTO users (uid, email, name, picture, last_login, created_at)
       VALUES ($1, COALESCE($2, 'user@example.com'), COALESCE($3, 'Authenticated User'), COALESCE($4, $6), $5, $5)
       ON CONFLICT (uid) DO UPDATE SET
         email = COALESCE($2, users.email),
         name = COALESCE($3, users.name),
         picture = COALESCE($4, users.picture),
         last_login = $5
       RETURNING uid, email, name, picture, last_login`,
      [user.uid, user.email ?? null, user.name ?? null, user.picture ?? null, now, defaultPicture]
    );

    const row = result.rows[0];
    return {
      uid: row.uid,
      email: row.email,
      name: row.name,
      picture: row.picture,
      lastLogin: Number(row.last_login),
    };
  }

  /**
   * Returns list of all registered application users.
   */
  public static async getAllUsers(): Promise<RegisteredUser[]> {
    const result = await pool.query(
      'SELECT uid, email, name, picture, last_login FROM users ORDER BY last_login DESC'
    );

    return result.rows.map((row) => ({
      uid: row.uid,
      email: row.email,
      name: row.name,
      picture: row.picture,
      lastLogin: Number(row.last_login),
    }));
  }
}
