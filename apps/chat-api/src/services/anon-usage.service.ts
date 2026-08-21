import { firestore } from '../db/firestore';
import { RateLimitUsageEntry } from '@chat-monorepo/shared';
import { SystemLimitsService } from './system-limits.service';
import { ModelConfigService } from './model-config.service';

/**
 * Firestore-backed persistent rate limiter, following the same
 * collection-per-service pattern as ThreadService/UserRegistryService.
 *
 * Replaces the old in-memory `Map<ip, count>` counter, which reset on every
 * redeploy/restart and was inconsistent across Cloud Run's multiple
 * concurrent instances (each instance had its own Map). A Firestore
 * transaction gives an atomic check-and-increment that's correct even when
 * two instances handle requests for the same key at the same moment.
 *
 * Two independent uses, two independent key shapes:
 *  - Anonymous pre-sign-in trial, keyed `anon:{ip}` - see
 *    auth.middleware.ts's authenticateOrAllowTrial. Blocks with a 401
 *    (sign-in required), same as always.
 *  - Per-user, PER-MODEL daily quota, keyed `user:{uid}:model:{modelId}` -
 *    see orchestration/graph.ts. There is deliberately no flat per-user
 *    total any more (that used to block every model equally and confused
 *    users with a bare "429" for hitting an unrelated cap); only models an
 *    admin has explicitly given a dailyLimitPerUser (see
 *    model-config.service.ts) are tracked at all, and hitting one never
 *    blocks the request - graph.ts falls back to a cheaper model instead.
 */

interface RateLimitDoc {
  count: number;
  windowStart: number;
  updatedAt: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number;
}

/** Firestore document IDs may not contain "/"; IP addresses/uids don't
 *  normally contain one, but encode defensively so a malformed key can
 *  never throw instead of just being rate-limited under a safe bucket. */
function sanitizeKey(key: string): string {
  return encodeURIComponent(key);
}

function effectiveCount(data: RateLimitDoc | undefined, now: number, windowMs: number): { count: number; windowStart: number } {
  const windowStart = data?.windowStart ?? now;
  const windowExpired = now - windowStart >= windowMs;
  return { count: windowExpired ? 0 : data?.count ?? 0, windowStart: windowExpired ? now : windowStart };
}

export class AnonUsageService {
  private static rateLimitsCollection() {
    return firestore.collection('rateLimits');
  }

  /** Builds the per-user, per-model rate-limit key - the one shared spot
   *  that defines this shape, so graph.ts, chat.routes.ts (the /models
   *  enrichment), and the admin usage snapshot below can never drift apart
   *  on the key format. */
  public static modelUsageKey(uid: string, modelId: string): string {
    return `user:${uid}:model:${modelId}`;
  }

  /**
   * Atomically checks the current window's count against `limit` and, if
   * under the limit, increments it. Returns whether the request is allowed.
   * A stale window (older than windowMs) is reset to a fresh count of 1
   * rather than rejected.
   */
  public static async checkAndConsume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const docRef = this.rateLimitsCollection().doc(sanitizeKey(key));
    const now = Date.now();

    return firestore.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      const data = snap.exists ? (snap.data() as RateLimitDoc) : undefined;
      const { count: currentCount, windowStart } = effectiveCount(data, now, windowMs);

      if (currentCount >= limit) {
        return {
          allowed: false,
          remaining: 0,
          limit,
          resetAt: windowStart + windowMs,
        };
      }

      const newCount = currentCount + 1;

      tx.set(docRef, {
        count: newCount,
        windowStart,
        updatedAt: now,
      } as RateLimitDoc);

      return {
        allowed: true,
        remaining: Math.max(0, limit - newCount),
        limit,
        resetAt: windowStart + windowMs,
      };
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
    const doc = await this.rateLimitsCollection().doc(sanitizeKey(key)).get();
    const now = Date.now();
    const data = doc.exists ? (doc.data() as RateLimitDoc) : undefined;
    const { count, windowStart } = effectiveCount(data, now, windowMs);
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
   *
   * Bounded full-collection scan, same scale assumption as
   * AnalyticsService's usage-collection reads - fine at this app's size
   * (one doc per active user-model pair per window), not intended to
   * survive unbounded growth without a follow-up (e.g. TTL-deleting expired
   * docs).
   */
  public static async listUsageSnapshot(): Promise<RateLimitUsageEntry[]> {
    const [limits, modelConfig] = await Promise.all([SystemLimitsService.getLimits(), ModelConfigService.getModelConfig()]);
    const windowMs = limits.rateLimitWindowHours * 60 * 60 * 1000;
    const modelLimits = new Map(modelConfig.models.map((m) => [m.id, m.dailyLimitPerUser]));
    const now = Date.now();

    const snapshot = await this.rateLimitsCollection().get();

    const entries: RateLimitUsageEntry[] = [];
    for (const doc of snapshot.docs) {
      const data = doc.data() as RateLimitDoc;
      const { count, windowStart } = effectiveCount(data, now, windowMs);
      if (count <= 0) continue; // expired/empty windows aren't "occupying" anything right now

      const decodedKey = decodeURIComponent(doc.id);

      if (decodedKey.startsWith('anon:')) {
        entries.push({
          key: decodedKey.slice('anon:'.length),
          kind: 'anon',
          count,
          limit: limits.anonTrialMessageLimit,
          percent: limits.anonTrialMessageLimit > 0 ? count / limits.anonTrialMessageLimit : 0,
          resetAt: windowStart + windowMs,
        });
        continue;
      }

      const modelMatch = decodedKey.match(/^user:(.+):model:(.+)$/);
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
