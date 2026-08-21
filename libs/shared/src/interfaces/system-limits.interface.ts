/**
 * Admin-tunable operational limits — the ones that gate user-facing
 * throughput/uploads and used to be hardcoded constants scattered across
 * apps/chat-api/src/services/anon-usage.service.ts and routes/chat.routes.ts.
 * Backed by a single Firestore doc (see apps/chat-api/src/services/
 * system-limits.service.ts) with an in-memory TTL cache, the same pattern
 * ModelConfigService already established for dynamic model config.
 */
export interface SystemLimitsDto {
  /** Free messages an unauthenticated visitor gets (per IP) before sign-in is required. */
  anonTrialMessageLimit: number;
  /** Messages a signed-in user gets per rolling window before a 429. */
  authDailyMessageLimit: number;
  /** Length of the rolling rate-limit window, in hours. */
  rateLimitWindowHours: number;
  /** Max size (bytes) for a single knowledge-base document upload (.txt/.md/.csv/.json/.pdf). */
  documentUploadMaxBytes: number;
  /** Max size (bytes) for a single chat photo/video attachment. */
  attachmentMaxBytes: number;
  /** Max photo/video attachments allowed on one chat message. */
  attachmentMaxCount: number;
  updatedAt?: number;
}

/** One rate-limit key's current standing against its cap, for the admin
 *  "how much is occupied" panel. Never mutates the underlying counter -
 *  a read-only snapshot. */
export interface RateLimitUsageEntry {
  /** 'user:<uid>' or 'anon:<ip>', decoded for display. */
  key: string;
  kind: 'auth' | 'anon';
  count: number;
  limit: number;
  /** count / limit, 0..1+ (can exceed 1 only if the limit was lowered after the count accrued). */
  percent: number;
  resetAt: number;
}
