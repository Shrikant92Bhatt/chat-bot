import { RateLimitUsageEntry } from '@chat-monorepo/shared';
import { query, withTransaction } from '../db/postgres';
import { SystemLimitsService } from './system-limits.service';
import { ModelConfigService } from './model-config.service';

/**
 * Postgres-backed persistent rate limiter, following the same
 * per-table pattern as ThreadService/UserRegistryService.
 *
 * Uses a transaction + `SELECT ... FOR UPDATE` row lock for the atomic
 * check-and-increment - the Postgres equivalent of the Firestore
 * transaction this replaces, with the same correctness guarantee: two
 * concurrent requests for the same key (e.g. two Vercel function
 * invocations handling the same user's rapid double-click) never both read
 * the same pre-increment count and both get allowed past a limit of one.
 *
 * Three independent uses, three key shapes:
 *  - Anonymous pre-sign-in trial, keyed `anon:{ip}` - see
 *    auth.middleware.ts's authenticateOrAllowTrial. Blocks with a 401
 *    (sign-in required), same as always.
 *  - Per-user, PER-MODEL daily quota, keyed `user:{uid}:model:{modelId}` -
 *    see orchestration/graph.ts. Hitting one never blocks the request -
 *    graph.ts falls back to a cheaper model instead.
 *  - Per-user GLOBAL daily quota, keyed `user:{uid}:global` - hard ceiling
 *    across every model so uncapped Flash cannot run unbounded. Hitting it
 *    429s (see chat.routes.ts POST /stream).
 */

interface RateLimitRow {
  count: number;
  window_start: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number;
}

function effectiveCount(data: RateLimitRow | undefined, now: number, windowMs: number): { count: number; windowStart: number } {
  const windowStart = data?.window_start ?? now;
  const windowExpired = now - windowStart >= windowMs;
  return { count: windowExpired ? 0 : data?.count ?? 0, windowStart: windowExpired ? now : windowStart };
}

export class AnonUsageService {
  /** Builds the per-user, per-model rate-limit key - the one shared spot
   *  that defines this shape, so graph.ts, chat.routes.ts (the /models
   *  enrichment), and the admin usage snapshot below can never drift apart
   *  on the key format. */
  public static modelUsageKey(uid: string, modelId: string): string {
    return `user:${uid}:model:${modelId}`;
  }

  public static globalUsageKey(uid: string): string {
    return `user:${uid}:global`;
  }

  public static async checkAuthDaily(uid: string): Promise<RateLimitResult> {
    const limits = await SystemLimitsService.getLimits();
    return this.checkAndConsume(this.globalUsageKey(uid), limits.authDailyMessageLimit, limits.rateLimitWindowHours * 60 * 60 * 1000);
  }

  /**
   * Atomically checks the current window's count against `limit` and, if
   * under the limit, increments it. Returns whether the request is allowed.
   * A stale window (older than windowMs) is reset to a fresh count of 1
   * rather than rejected.
   */
  public static async checkAndConsume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();

    return withTransaction(async (client) => {
      // Ensure a row exists before locking it - a plain SELECT ... FOR
      // UPDATE on zero rows locks nothing, so the very first request for a
      // brand new key needs a row to exist first. ON CONFLICT DO NOTHING
      // means two concurrent first-ever requests for the same key both
      // land here safely; only one actually inserts.
      await client.query(
        'INSERT INTO rate_limits (key, count, window_start, updated_at) VALUES ($1, 0, $2, $2) ON CONFLICT (key) DO NOTHING',
        [key, now]
      );

      const result = await client.query<RateLimitRow>('SELECT count, window_start FROM rate_limits WHERE key = $1 FOR UPDATE', [key]);
      const { count: currentCount, windowStart } = effectiveCount(result.rows[0], now, windowMs);

      if (currentCount >= limit) {
        return { allowed: false, remaining: 0, limit, resetAt: windowStart + windowMs };
      }

      const newCount = currentCount + 1;
      await client.query('UPDATE rate_limits SET count = $2, window_start = $3, updated_at = $4 WHERE key = $1', [
        key,
        newCount,
        windowStart,
        now,
      ]);

      return { allowed: true, remaining: Math.max(0, limit - newCount), limit, resetAt: windowStart + windowMs };
    });
  }

  /** Convenience wrapper for the anonymous-trial key shape. */
  public static async checkAnonTrial(ip: string): Promise<RateLimitResult> {
    const limits = await SystemLimitsService.getLimits();
    return this.checkAndConsume(`anon:${ip}`, limits.anonTrialMessageLimit, limits.rateLimitWindowHours * 60 * 60 * 1000);
  }

  /**
   * Non-consuming read of a single key's current standing - used to decide
   * whether to grey out a model in the dropdown (chat.routes.ts GET
   * /models) WITHOUT counting as a use of it.
   */
  public static async peek(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    const rows = await query<RateLimitRow>('SELECT count, window_start FROM rate_limits WHERE key = $1', [key]);
    const now = Date.now();
    const { count, windowStart } = effectiveCount(rows[0], now, windowMs);
    return { count, resetAt: windowStart + windowMs };
  }

  /**
   * Read-only snapshot of every currently-tracked rate-limit key against its
   * CURRENT (possibly just-changed) limit - powers the admin console's "how
   * much of today's quota is used" panel. Never increments a counter; a
   * window past its expiry reads as 0/reset rather than being treated as
   * stale-but-still-counted. A per-model key whose model no longer has a
   * configured cap (admin removed it) is skipped - it isn't "occupying"
   * anything real any more.
   */
  public static async listUsageSnapshot(): Promise<RateLimitUsageEntry[]> {
    const [limits, modelConfig] = await Promise.all([SystemLimitsService.getLimits(), ModelConfigService.getModelConfig()]);
    const windowMs = limits.rateLimitWindowHours * 60 * 60 * 1000;
    const modelLimits = new Map(modelConfig.models.map((m) => [m.id, m.dailyLimitPerUser]));
    const now = Date.now();

    const rows = await query<{ key: string } & RateLimitRow>('SELECT key, count, window_start FROM rate_limits');

    const entries: RateLimitUsageEntry[] = [];
    for (const row of rows) {
      const { count, windowStart } = effectiveCount(row, now, windowMs);
      if (count <= 0) continue; // expired/empty windows aren't "occupying" anything right now

      if (row.key.startsWith('anon:')) {
        entries.push({
          key: row.key.slice('anon:'.length),
          kind: 'anon',
          count,
          limit: limits.anonTrialMessageLimit,
          percent: limits.anonTrialMessageLimit > 0 ? count / limits.anonTrialMessageLimit : 0,
          resetAt: windowStart + windowMs,
        });
        continue;
      }

      const globalMatch = row.key.match(/^user:(.+):global$/);
      if (globalMatch) {
        const uid = globalMatch[1];
        const limit = limits.authDailyMessageLimit;
        entries.push({
          key: uid,
          kind: 'auth',
          modelId: 'all-models',
          count,
          limit,
          percent: limit > 0 ? count / limit : 0,
          resetAt: windowStart + windowMs,
        });
        continue;
      }

      const modelMatch = row.key.match(/^user:(.+):model:(.+)$/);
      if (modelMatch) {
        const [, uid, modelId] = modelMatch;
        const limit = modelLimits.get(modelId);
        if (!limit) continue; // model no longer capped - nothing to show

        entries.push({
          key: uid,
          kind: 'auth',
          modelId,
          count,
          limit,
          percent: count / limit,
          resetAt: windowStart + windowMs,
        });
      }
    }

    return entries.sort((a, b) => b.percent - a.percent);
  }
}
