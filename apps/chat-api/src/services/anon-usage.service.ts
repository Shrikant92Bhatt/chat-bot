import { firestore } from '../db/firestore';

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
 * Used for BOTH anonymous (keyed by IP) and authenticated (keyed by uid)
 * daily limits - see auth.middleware.ts's authenticateOrAllowTrial.
 */

const WINDOW_MS = (Number(process.env.RATE_LIMIT_WINDOW_HOURS) || 24) * 60 * 60 * 1000;

/** Anonymous (pre-sign-in) trial message limit, keyed by IP. Preserves the
 *  historical "1 free message before sign-in" behavior by default. */
export const ANON_TRIAL_MESSAGE_LIMIT = Number(process.env.ANON_TRIAL_MESSAGE_LIMIT) || 1;

/** Authenticated free-tier daily message limit, keyed by uid. Previously
 *  unlimited once signed in - this adds a real per-user daily quota. */
export const AUTH_DAILY_MESSAGE_LIMIT = Number(process.env.AUTH_DAILY_MESSAGE_LIMIT) || 20;

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

export class AnonUsageService {
  private static rateLimitsCollection() {
    return firestore.collection('rateLimits');
  }

  /**
   * Atomically checks the current window's count against `limit` and, if
   * under the limit, increments it. Returns whether the request is allowed.
   * A stale window (older than WINDOW_MS) is reset to a fresh count of 1
   * rather than rejected.
   */
  public static async checkAndConsume(key: string, limit: number): Promise<RateLimitResult> {
    const docRef = this.rateLimitsCollection().doc(sanitizeKey(key));
    const now = Date.now();

    return firestore.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      const data = snap.exists ? (snap.data() as RateLimitDoc) : undefined;

      const windowStart = data?.windowStart ?? now;
      const windowExpired = now - windowStart >= WINDOW_MS;
      const currentCount = windowExpired ? 0 : data?.count ?? 0;

      if (currentCount >= limit) {
        return {
          allowed: false,
          remaining: 0,
          limit,
          resetAt: windowStart + WINDOW_MS,
        };
      }

      const newCount = currentCount + 1;
      const newWindowStart = windowExpired ? now : windowStart;

      tx.set(docRef, {
        count: newCount,
        windowStart: newWindowStart,
        updatedAt: now,
      } as RateLimitDoc);

      return {
        allowed: true,
        remaining: Math.max(0, limit - newCount),
        limit,
        resetAt: newWindowStart + WINDOW_MS,
      };
    });
  }

  /** Convenience wrapper for the anonymous-trial key shape. */
  public static async checkAnonTrial(ip: string): Promise<RateLimitResult> {
    return this.checkAndConsume(`anon:${ip}`, ANON_TRIAL_MESSAGE_LIMIT);
  }

  /** Convenience wrapper for the authenticated per-user daily limit. */
  public static async checkAuthDailyLimit(uid: string): Promise<RateLimitResult> {
    return this.checkAndConsume(`user:${uid}`, AUTH_DAILY_MESSAGE_LIMIT);
  }
}
