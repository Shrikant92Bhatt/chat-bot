export interface RegisteredUser {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
  lastLogin: number;
}

export class UserRegistryService {
  private static usersMap = new Map<string, RegisteredUser>();

  /**
   * Automatically records or updates a user profile upon Google OAuth login.
   */
  public static registerOrUpdateUser(user: { uid: string; email?: string; name?: string; picture?: string }): RegisteredUser {
    const existing = this.usersMap.get(user.uid);
    const updatedUser: RegisteredUser = {
      uid: user.uid,
      email: user.email || existing?.email || 'user@example.com',
      name: user.name || existing?.name || 'Authenticated User',
      picture: user.picture || existing?.picture || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + user.uid,
      lastLogin: Date.now(),
    };

    this.usersMap.set(user.uid, updatedUser);
    return updatedUser;
  }

  /**
   * Returns list of all registered application users.
   */
  public static getAllUsers(): RegisteredUser[] {
    return Array.from(this.usersMap.values());
  }
}
