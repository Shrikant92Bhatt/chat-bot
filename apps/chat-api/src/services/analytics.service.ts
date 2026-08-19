import { firestore } from '../db/firestore';
import { UsageRecord } from './usage.service';

/**
 * Read-side aggregation over the `usage` collection for the admin analytics
 * app (apps/admin-analytics). Write-side lives in usage.service.ts.
 *
 * ── Scaling caveat (read this before trusting these numbers at volume) ──
 * Firestore has no server-side GROUP BY / SUM. Every aggregate below is
 * produced by reading the date-filtered record set into memory and folding
 * it here, which means cost and latency grow linearly with the number of
 * chat requests in the window - one document read per request logged. At the
 * current scale (a handful of users) that is a few hundred reads; at, say,
 * 100k requests/month it becomes both slow and a real Firestore bill, and
 * it will eventually exceed what a single Cloud Run instance should hold in
 * memory at once.
 *
 * The project's own architecture doc already names the intended fix:
 * Firestore for app-level state, a scheduled BigQuery export for
 * large-scale analytics. The real deployment path is a Firestore->BigQuery
 * export (or a Pub/Sub fan-out on write) plus scheduled rollup queries, with
 * these endpoints then serving pre-aggregated daily rows instead of raw
 * records. `MAX_RECORDS_SCANNED` below caps the blast radius until then -
 * responses report `truncated: true` when the cap is hit rather than
 * silently returning a partial total as if it were complete.
 *
 * Query shape note: every query here filters on `timestamp` ONLY (a single
 * field), so it needs no composite index - see .agents/AGENTS.md's Firestore
 * query rules. Per-user/per-model narrowing is done in process for the same
 * reason.
 */

/** Hard ceiling on documents pulled into memory for one aggregation. */
const MAX_RECORDS_SCANNED = 20000;

export interface UsageSummary {
  windowDays: number;
  since: number;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalEstimatedCostUsd: number;
  activeUsers: number;
  /** True when MAX_RECORDS_SCANNED was hit and the totals are a lower bound. */
  truncated: boolean;
}

export interface UserUsageAggregate {
  userId: string;
  email: string | null;
  name: string | null;
  role: string;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalEstimatedCostUsd: number;
  lastActivity: number | null;
}

export interface ModelUsageAggregate {
  model: string;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalEstimatedCostUsd: number;
}

export interface DailyUsagePoint {
  /** UTC date, YYYY-MM-DD. */
  date: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

export interface UsageWindow {
  records: UsageRecord[];
  truncated: boolean;
}

/** Clamps a `?days=` query param into a sane, bounded window. */
export function parseWindowDays(raw: unknown, fallback = 30): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), 365);
}

function toUtcDateKey(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(0, 10);
}

export class AnalyticsService {
  private static usageCollection() {
    return firestore.collection('usage');
  }

  /**
   * Pulls the raw usage records for a rolling window, newest first. Single
   * `timestamp` range filter + orderBy on the same field, so only the
   * automatic single-field index is required.
   */
  public static async getUsageWindow(days: number): Promise<UsageWindow> {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;

    const snapshot = await this.usageCollection()
      .where('timestamp', '>=', since)
      .orderBy('timestamp', 'desc')
      .limit(MAX_RECORDS_SCANNED + 1)
      .get();

    const docs = snapshot.docs.map((doc) => doc.data() as UsageRecord);
    const truncated = docs.length > MAX_RECORDS_SCANNED;

    return { records: truncated ? docs.slice(0, MAX_RECORDS_SCANNED) : docs, truncated };
  }

  public static summarize(records: UsageRecord[], days: number, truncated: boolean): UsageSummary {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalEstimatedCostUsd = 0;
    const activeUserIds = new Set<string>();

    for (const record of records) {
      totalInputTokens += record.inputTokens ?? 0;
      totalOutputTokens += record.outputTokens ?? 0;
      totalEstimatedCostUsd += record.estimatedCostUsd ?? 0;
      if (record.userId) activeUserIds.add(record.userId);
    }

    return {
      windowDays: days,
      since: Date.now() - days * 24 * 60 * 60 * 1000,
      totalRequests: records.length,
      totalInputTokens,
      totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
      // Sub-cent precision, rounded to kill float accumulation noise.
      totalEstimatedCostUsd: Math.round(totalEstimatedCostUsd * 1e8) / 1e8,
      activeUsers: activeUserIds.size,
      truncated,
    };
  }

  /**
   * Per-user rollup - "which user consumes how many tokens". Anonymous/
   * trial requests (userId === null) are bucketed under the literal id
   * `anonymous` rather than dropped, so the per-user totals still add up to
   * the summary totals.
   */
  public static aggregateByUser(records: UsageRecord[]): UserUsageAggregate[] {
    const byUser = new Map<string, UserUsageAggregate>();

    for (const record of records) {
      const userId = record.userId ?? 'anonymous';
      let entry = byUser.get(userId);

      if (!entry) {
        entry = {
          userId,
          email: null,
          name: null,
          role: 'user',
          totalRequests: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          totalEstimatedCostUsd: 0,
          lastActivity: null,
        };
        byUser.set(userId, entry);
      }

      entry.totalRequests += 1;
      entry.totalInputTokens += record.inputTokens ?? 0;
      entry.totalOutputTokens += record.outputTokens ?? 0;
      entry.totalEstimatedCostUsd += record.estimatedCostUsd ?? 0;
      entry.lastActivity = Math.max(entry.lastActivity ?? 0, record.timestamp);
    }

    return [...byUser.values()]
      .map((entry) => ({
        ...entry,
        totalTokens: entry.totalInputTokens + entry.totalOutputTokens,
        totalEstimatedCostUsd: Math.round(entry.totalEstimatedCostUsd * 1e8) / 1e8,
      }))
      .sort((a, b) => b.totalTokens - a.totalTokens || b.totalRequests - a.totalRequests);
  }

  public static aggregateByModel(records: UsageRecord[]): ModelUsageAggregate[] {
    const byModel = new Map<string, ModelUsageAggregate>();

    for (const record of records) {
      const model = record.model || 'unknown';
      let entry = byModel.get(model);

      if (!entry) {
        entry = {
          model,
          totalRequests: 0,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalTokens: 0,
          totalEstimatedCostUsd: 0,
        };
        byModel.set(model, entry);
      }

      entry.totalRequests += 1;
      entry.totalInputTokens += record.inputTokens ?? 0;
      entry.totalOutputTokens += record.outputTokens ?? 0;
      entry.totalEstimatedCostUsd += record.estimatedCostUsd ?? 0;
    }

    return [...byModel.values()]
      .map((entry) => ({
        ...entry,
        totalTokens: entry.totalInputTokens + entry.totalOutputTokens,
        totalEstimatedCostUsd: Math.round(entry.totalEstimatedCostUsd * 1e8) / 1e8,
      }))
      .sort((a, b) => b.totalRequests - a.totalRequests);
  }

  /**
   * Dense daily series for the time-series chart: every day in the window is
   * emitted, including zero-activity days, so the chart's x-axis is evenly
   * spaced instead of silently collapsing gaps.
   */
  public static aggregateDaily(records: UsageRecord[], days: number): DailyUsagePoint[] {
    const byDate = new Map<string, DailyUsagePoint>();
    const dayMs = 24 * 60 * 60 * 1000;
    const now = Date.now();

    for (let i = days - 1; i >= 0; i--) {
      const key = toUtcDateKey(now - i * dayMs);
      byDate.set(key, {
        date: key,
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
      });
    }

    for (const record of records) {
      const key = toUtcDateKey(record.timestamp);
      const point = byDate.get(key);
      // A record can fall a few ms outside the reconstructed day range at the
      // window edge - skip rather than inventing an out-of-order bucket.
      if (!point) continue;

      point.requests += 1;
      point.inputTokens += record.inputTokens ?? 0;
      point.outputTokens += record.outputTokens ?? 0;
      point.estimatedCostUsd += record.estimatedCostUsd ?? 0;
    }

    return [...byDate.values()].map((point) => ({
      ...point,
      totalTokens: point.inputTokens + point.outputTokens,
      estimatedCostUsd: Math.round(point.estimatedCostUsd * 1e8) / 1e8,
    }));
  }
}
