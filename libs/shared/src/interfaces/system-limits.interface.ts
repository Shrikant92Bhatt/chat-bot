/**
 * Admin-tunable operational limits — the ones that gate user-facing
 * throughput/uploads and used to be hardcoded constants scattered across
 * apps/chat-api/src/services/anon-usage.service.ts and routes/chat.routes.ts.
 * Backed by a single Firestore doc (see apps/chat-api/src/services/
 * system-limits.service.ts) with an in-memory TTL cache, the same pattern
 * ModelConfigService already established for dynamic model config.
 *
 * There is deliberately no flat per-user daily message cap here any more -
 * that used to block a signed-in user's every model equally and surface as
 * a bare "429" regardless of which (possibly free) model they were using.
 * Cost control is now per-model (SelectableModel.dailyLimitPerUser, see
 * chat.interface.ts) with a graceful fallback instead of a hard block - see
 * orchestration/graph.ts.
 */
export interface SystemLimitsDto {
  /** Free messages an unauthenticated visitor gets (per IP) before sign-in is required. */
  anonTrialMessageLimit: number;
  /** Length of the rolling rate-limit window, in hours - shared by the anon trial above and every model's dailyLimitPerUser. */
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
  /** Decoded IP (kind 'anon') or uid (kind 'auth'), for display. */
  key: string;
  kind: 'auth' | 'anon';
  /** Set only for kind 'auth' - which model this count is against. */
  modelId?: string;
  count: number;
  limit: number;
  /** count / limit, 0..1+ (can exceed 1 only if the limit was lowered after the count accrued). */
  percent: number;
  resetAt: number;
}
