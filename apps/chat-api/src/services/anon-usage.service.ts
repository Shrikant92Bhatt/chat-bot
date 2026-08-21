import { firestore } from '../db/firestore';
import { RateLimitUsageEntry } from '@chat-monorepo/shared';
import { SystemLimitsService } from './system-limits.service';

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
 * daily limits - see auth.middleware.ts's authenticateOrAllowTrial. The
 * limit/window values themselves are admin-editable (SystemLimitsService)
 * rather than hardcoded here, so a limit change takes effect on the next
 * request without a redeploy.
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

export class AnonUsageService {
  private static rateLimitsCollection() {
    return firestore.collection('rateLimits');
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

      const windowStart = data?.windowStart ?? now;
      const windowExpired = now - windowStart >= windowMs;
      const currentCount = windowExpired ? 0 : data?.count ?? 0;

      if (currentCount >= limit) {
        return {
          allowed: false,
          remaining: 0,
          limit,
          resetAt: windowStart + windowMs,
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
        resetAt: newWindowStart + windowMs,
      };
    });
  }

  /** Convenience wrapper for the anonymous-trial key shape. */
  public static async checkAnonTrial(ip: string): Promise<RateLimitResult> {
    const limits = await SystemLimitsService.getLimits();
    return this.checkAndConsume(`anon:${ip}`, limits.anonTrialMessageLimit, limits.rateLimitWindowHours * 60 * 60 * 1000);
  }

  /** Convenience wrapper for the authenticated per-user daily limit. */
  public static async checkAuthDailyLimit(uid: string): Promise<RateLimitResult> {
    const limits = await SystemLimitsService.getLimits();
    return this.checkAndConsume(`user:${uid}`, limits.authDailyMessageLimit, limits.rateLimitWindowHours * 60 * 60 * 1000);
  }

  /**
   * Read-only snapshot of every currently-tracked rate-limit key against its
   * CURRENT (possibly just-changed) limit - powers the admin console's "how
   * much of today's quota is used" panel. Never increments a counter; a
   * window past its expiry reads as 0/reset rather than being treated as
   * stale-but-still-counted.
   *
   * Bounded full-collection scan, same scale assumption as
   * AnalyticsService's usage-collection reads - fine at this app's size
   * (one doc per active user/IP per window), not intended to survive
   * unbounded growth without a follow-up (e.g. TTL-deleting expired docs).
   */
  public static async listUsageSnapshot(): Promise<RateLimitUsageEntry[]> {
    const limits = await SystemLimitsService.getLimits();
    const windowMs = limits.rateLimitWindowHours * 60 * 60 * 1000;
    const now = Date.now();

    const snapshot = await this.rateLimitsCollection().get();

    const entries: RateLimitUsageEntry[] = [];
    for (const doc of snapshot.docs) {
      const data = doc.data() as RateLimitDoc;
      const windowExpired = now - data.windowStart >= windowMs;
      const count = windowExpired ? 0 : data.count;
      if (count <= 0) continue; // expired/empty windows aren't "occupying" anything right now

      const decodedKey = decodeURIComponent(doc.id);
      const kind: 'auth' | 'anon' = decodedKey.startsWith('user:') ? 'auth' : 'anon';
      const limit = kind === 'auth' ? limits.authDailyMessageLimit : limits.anonTrialMessageLimit;
      const windowStart = windowExpired ? now : data.windowStart;

      entries.push({
        key: decodedKey,
        kind,
        count,
        limit,
        percent: limit > 0 ? count / limit : 0,
        resetAt: windowStart + windowMs,
      });
    }

    return entries.sort((a, b) => b.percent - a.percent);
  }
}
