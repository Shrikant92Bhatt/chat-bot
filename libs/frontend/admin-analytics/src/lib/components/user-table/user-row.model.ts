import { AdminUser, UserUsageAggregate } from '../../services/admin-api.service';

/**
 * One row of the Users view: a registered account joined to whatever it spent
 * in the selected window.
 *
 * The two backend collections don't line up one-to-one, and both directions of
 * the mismatch are real:
 *  - a registered user with no traffic in the window has no `by-user` row, and
 *    must still appear (they exist, they cost nothing yet, and their role is
 *    still managed here);
 *  - a `by-user` row whose uid is no longer in the `users` registry has usage
 *    but no account - `registered: false` marks it so the table can say why the
 *    row has no name and no role control, instead of rendering a broken one.
 */
export interface UserRow {
  uid: string;
  email: string | null;
  name: string | null;
  picture: string | null;
  /** Null only for a usage row with no matching registry document. */
  role: 'user' | 'admin' | null;
  lastLogin: number | null;
  registered: boolean;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalEstimatedCostUsd: number;
  lastActivity: number | null;
  /** 0..1 share of the window's total tokens - drives the in-row meter. */
  tokenShare: number;
}

export function buildUserRows(registered: AdminUser[], usage: UserUsageAggregate[]): UserRow[] {
  const usageByUid = new Map(usage.map((u) => [u.userId, u]));
  const totalTokens = usage.reduce((sum, u) => sum + u.totalTokens, 0);
  const share = (tokens: number) => (totalTokens > 0 ? tokens / totalTokens : 0);

  const rows: UserRow[] = registered.map((user) => {
    const spend = usageByUid.get(user.uid);
    usageByUid.delete(user.uid);
    return {
      uid: user.uid,
      email: user.email,
      name: user.name,
      picture: user.picture,
      role: user.role,
      lastLogin: user.lastLogin,
      registered: true,
      totalRequests: spend?.totalRequests ?? 0,
      totalInputTokens: spend?.totalInputTokens ?? 0,
      totalOutputTokens: spend?.totalOutputTokens ?? 0,
      totalTokens: spend?.totalTokens ?? 0,
      totalEstimatedCostUsd: spend?.totalEstimatedCostUsd ?? 0,
      lastActivity: spend?.lastActivity ?? null,
      tokenShare: share(spend?.totalTokens ?? 0),
    };
  });

  // Whatever is left in the map has usage but no account behind it.
  for (const orphan of usageByUid.values()) {
    rows.push({
      uid: orphan.userId,
      email: orphan.email,
      name: orphan.name,
      picture: null,
      role: null,
      lastLogin: null,
      registered: false,
      totalRequests: orphan.totalRequests,
      totalInputTokens: orphan.totalInputTokens,
      totalOutputTokens: orphan.totalOutputTokens,
      totalTokens: orphan.totalTokens,
      totalEstimatedCostUsd: orphan.totalEstimatedCostUsd,
      lastActivity: orphan.lastActivity,
      tokenShare: share(orphan.totalTokens),
    });
  }

  return rows;
}

export function userDisplayName(row: UserRow): string {
  return row.name || row.email || row.uid;
}

export function userInitial(row: UserRow): string {
  return (row.name || row.email || '?').charAt(0).toUpperCase();
}
