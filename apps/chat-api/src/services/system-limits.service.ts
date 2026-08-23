import { firestore } from '../db/firestore';
import { SystemLimitsDto } from '@chat-monorepo/shared';

/**
 * Firestore-backed, admin-editable operational limits — mirrors
 * ModelConfigService's pattern exactly (single `settings/{doc}` document +
 * in-memory TTL cache) so every hot-path read (rate-limit checks on every
 * chat turn, upload-size checks on every upload) stays a cache hit instead
 * of a Firestore round trip.
 *
 * DEFAULT_LIMITS preserves the exact values these used to be hardcoded/
 * env-only at, so an app that's never had an admin touch this screen
 * behaves identically to before this existed.
 */

const DEFAULT_LIMITS: SystemLimitsDto = {
  anonTrialMessageLimit: Number(process.env.ANON_TRIAL_MESSAGE_LIMIT) || 1,
  authDailyMessageLimit: Number(process.env.AUTH_DAILY_MESSAGE_LIMIT) || 20,
  rateLimitWindowHours: Number(process.env.RATE_LIMIT_WINDOW_HOURS) || 24,
  documentUploadMaxBytes: 10 * 1024 * 1024, // 10MB
  attachmentMaxBytes: 25 * 1024 * 1024, // 25MB
  attachmentMaxCount: 4,
};

/** Hard safety ceilings an admin can't exceed in either direction - protects
 *  the server from a fat-fingered "0 messages/day" lockout or a "10GB
 *  upload" resource-exhaustion footgun. */
const BOUNDS: Record<keyof Omit<SystemLimitsDto, 'updatedAt'>, { min: number; max: number }> = {
  anonTrialMessageLimit: { min: 0, max: 100 },
  authDailyMessageLimit: { min: 1, max: 500 },
  rateLimitWindowHours: { min: 1, max: 24 * 30 },
  documentUploadMaxBytes: { min: 1024 * 1024, max: 50 * 1024 * 1024 },
  attachmentMaxBytes: { min: 1024 * 1024, max: 50 * 1024 * 1024 },
  attachmentMaxCount: { min: 1, max: 10 },
};

function clamp(value: unknown, fallback: number, bounds: { min: number; max: number }): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(n)));
}

export class SystemLimitsService {
  private static readonly SETTINGS_COLLECTION = 'settings';
  private static readonly LIMITS_DOC = 'system_limits';

  private static cached: SystemLimitsDto | null = null;
  private static cachedAt = 0;
  private static readonly CACHE_TTL_MS = 60 * 1000; // 1 minute - same as ModelConfigService

  public static async getLimits(): Promise<SystemLimitsDto> {
    const now = Date.now();
    if (this.cached && now - this.cachedAt < this.CACHE_TTL_MS) {
      return this.cached;
    }

    try {
      const doc = await firestore.collection(this.SETTINGS_COLLECTION).doc(this.LIMITS_DOC).get();
      if (doc.exists) {
        const data = doc.data() as Partial<SystemLimitsDto>;
        const merged: SystemLimitsDto = { ...DEFAULT_LIMITS, ...data };
        this.cached = merged;
        this.cachedAt = now;
        return merged;
      }
    } catch (error) {
      console.warn('[SystemLimitsService] Failed to read limits from Firestore, using defaults:', error);
    }

    this.cached = DEFAULT_LIMITS;
    this.cachedAt = now;
    return DEFAULT_LIMITS;
  }

  /** Validates + clamps every field against BOUNDS before persisting - a
   *  malformed or malicious PUT body can never write an out-of-range value. */
  public static async saveLimits(partial: Partial<SystemLimitsDto>): Promise<SystemLimitsDto> {
    const existing = await this.getLimits();

    const merged: SystemLimitsDto = {
      anonTrialMessageLimit: clamp(partial.anonTrialMessageLimit, existing.anonTrialMessageLimit, BOUNDS.anonTrialMessageLimit),
      authDailyMessageLimit: clamp(partial.authDailyMessageLimit, existing.authDailyMessageLimit, BOUNDS.authDailyMessageLimit),
      rateLimitWindowHours: clamp(partial.rateLimitWindowHours, existing.rateLimitWindowHours, BOUNDS.rateLimitWindowHours),
      documentUploadMaxBytes: clamp(partial.documentUploadMaxBytes, existing.documentUploadMaxBytes, BOUNDS.documentUploadMaxBytes),
      attachmentMaxBytes: clamp(partial.attachmentMaxBytes, existing.attachmentMaxBytes, BOUNDS.attachmentMaxBytes),
      attachmentMaxCount: clamp(partial.attachmentMaxCount, existing.attachmentMaxCount, BOUNDS.attachmentMaxCount),
      updatedAt: Date.now(),
    };

    await firestore.collection(this.SETTINGS_COLLECTION).doc(this.LIMITS_DOC).set(merged);

    this.cached = merged;
    this.cachedAt = Date.now();

    return merged;
  }
}
