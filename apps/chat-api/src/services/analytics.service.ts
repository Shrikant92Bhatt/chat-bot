import { query } from '../db/postgres';
import { UsagePurpose, UsageRecord } from './usage.service';

/**
 * Read-side aggregation over the `usage` table for the admin analytics app
 * (apps/admin-analytics). Write-side lives in usage.service.ts.
 *
 * This used to read every matching Firestore document into memory and fold
 * it in JS - Firestore has no server-side GROUP BY/SUM, so that was the
 * only option, capped by MAX_RECORDS_SCANNED to bound the blast radius, with
 * a scheduled BigQuery export flagged as the eventual real fix at volume.
 * Postgres makes that whole problem disappear: every aggregate below is a
 * single GROUP BY/SUM query that runs server-side regardless of how many
 * rows it scans, so there's no scan cap, no `truncated` risk, and no
 * separate export pipeline to build later.
 */

/** Hard ceiling on raw rows returned by one drill-down page - this is the
 *  one endpoint that still returns individual records to the client rather
 *  than an aggregate, so it's the one place a cap still means something. */
const MAX_RECORDS_PER_PAGE = 500;

export interface UsageSummary {
  windowDays: number;
  since: number;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalEstimatedCostUsd: number;
  activeUsers: number;
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

/**
 * "What was this spend actually FOR" - 'chat' (answering the user, including
 * the research planner) vs the three sidecar calls that support a turn
 * without being it (summarization/memory_extraction/follow_up_suggestions).
 * Before these were logged with a `purpose` at all, that housekeeping cost
 * was invisible - not missing from the totals above, but silently blended
 * into whatever model the user picked, which made a Claude/GPT user's usage
 * row look like 100% Claude/GPT spend when part of it was always Gemini
 * Flash running in the background. This is what makes that split visible.
 */
export interface PurposeUsageAggregate {
  purpose: UsagePurpose;
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

export interface UsageRecordsPage {
  records: UsageRecord[];
  totalMatching: number;
  truncated: boolean;
}

/** Clamps a `?days=` query param into a sane, bounded window. */
export function parseWindowDays(raw: unknown, fallback = 30): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), 365);
}

function round(n: number): number {
  // Sub-cent precision, rounded to kill float accumulation noise - same
  // rounding usage.service.ts applies to a single record's estimate.
  return Math.round(n * 1e8) / 1e8;
}

export class AnalyticsService {
  public static async getUsageSummary(days: number): Promise<UsageSummary> {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;

    const rows = await query<{
      total_requests: number;
      total_input_tokens: number;
      total_output_tokens: number;
      total_estimated_cost_usd: number;
      active_users: number;
    }>(
      `
      SELECT
        COUNT(*)::int AS total_requests,
        COALESCE(SUM(input_tokens), 0)::int AS total_input_tokens,
        COALESCE(SUM(output_tokens), 0)::int AS total_output_tokens,
        COALESCE(SUM(estimated_cost_usd), 0) AS total_estimated_cost_usd,
        COUNT(DISTINCT user_id)::int AS active_users
      FROM usage
      WHERE created_at >= $1
      `,
      [since]
    );

    const row = rows[0];
    return {
      windowDays: days,
      since,
      totalRequests: row?.total_requests ?? 0,
      totalInputTokens: row?.total_input_tokens ?? 0,
      totalOutputTokens: row?.total_output_tokens ?? 0,
      totalTokens: (row?.total_input_tokens ?? 0) + (row?.total_output_tokens ?? 0),
      totalEstimatedCostUsd: round(row?.total_estimated_cost_usd ?? 0),
      activeUsers: row?.active_users ?? 0,
    };
  }

  /**
   * Per-user rollup - "which user consumes how many tokens". Anonymous/
   * trial requests (user_id IS NULL) are bucketed under the literal id
   * `anonymous` rather than dropped, so the per-user totals still add up to
   * the summary totals.
   */
  public static async aggregateByUser(days: number): Promise<UserUsageAggregate[]> {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;

    const rows = await query<{
      user_id: string;
      total_requests: number;
      total_input_tokens: number;
      total_output_tokens: number;
      total_estimated_cost_usd: number;
      last_activity: number;
    }>(
      `
      SELECT
        COALESCE(user_id, 'anonymous') AS user_id,
        COUNT(*)::int AS total_requests,
        COALESCE(SUM(input_tokens), 0)::int AS total_input_tokens,
        COALESCE(SUM(output_tokens), 0)::int AS total_output_tokens,
        COALESCE(SUM(estimated_cost_usd), 0) AS total_estimated_cost_usd,
        MAX(created_at) AS last_activity
      FROM usage
      WHERE created_at >= $1
      GROUP BY COALESCE(user_id, 'anonymous')
      ORDER BY (COALESCE(SUM(input_tokens), 0) + COALESCE(SUM(output_tokens), 0)) DESC, COUNT(*) DESC
      `,
      [since]
    );

    return rows.map((row) => ({
      userId: row.user_id,
      email: null,
      name: null,
      role: 'user',
      totalRequests: row.total_requests,
      totalInputTokens: row.total_input_tokens,
      totalOutputTokens: row.total_output_tokens,
      totalTokens: row.total_input_tokens + row.total_output_tokens,
      totalEstimatedCostUsd: round(row.total_estimated_cost_usd),
      lastActivity: row.last_activity,
    }));
  }

  public static async aggregateByModel(days: number): Promise<ModelUsageAggregate[]> {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;

    const rows = await query<{
      model: string;
      total_requests: number;
      total_input_tokens: number;
      total_output_tokens: number;
      total_estimated_cost_usd: number;
    }>(
      `
      SELECT
        model,
        COUNT(*)::int AS total_requests,
        COALESCE(SUM(input_tokens), 0)::int AS total_input_tokens,
        COALESCE(SUM(output_tokens), 0)::int AS total_output_tokens,
        COALESCE(SUM(estimated_cost_usd), 0) AS total_estimated_cost_usd
      FROM usage
      WHERE created_at >= $1
      GROUP BY model
      ORDER BY COUNT(*) DESC
      `,
      [since]
    );

    return rows.map((row) => ({
      model: row.model || 'unknown',
      totalRequests: row.total_requests,
      totalInputTokens: row.total_input_tokens,
      totalOutputTokens: row.total_output_tokens,
      totalTokens: row.total_input_tokens + row.total_output_tokens,
      totalEstimatedCostUsd: round(row.total_estimated_cost_usd),
    }));
  }

  /**
   * Per-purpose rollup - see PurposeUsageAggregate's doc comment for why
   * this exists. Rows logged before the `purpose` column existed have none
   * stored; COALESCE buckets them under 'chat' rather than dropping them or
   * showing a confusing 'unknown' - they were all main chat-turn calls
   * (summarization/memory/suggestions logging didn't exist yet).
   */
  public static async aggregateByPurpose(days: number): Promise<PurposeUsageAggregate[]> {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;

    const rows = await query<{
      purpose: UsagePurpose;
      total_requests: number;
      total_input_tokens: number;
      total_output_tokens: number;
      total_estimated_cost_usd: number;
    }>(
      `
      SELECT
        COALESCE(purpose, 'chat') AS purpose,
        COUNT(*)::int AS total_requests,
        COALESCE(SUM(input_tokens), 0)::int AS total_input_tokens,
        COALESCE(SUM(output_tokens), 0)::int AS total_output_tokens,
        COALESCE(SUM(estimated_cost_usd), 0) AS total_estimated_cost_usd
      FROM usage
      WHERE created_at >= $1
      GROUP BY COALESCE(purpose, 'chat')
      ORDER BY SUM(estimated_cost_usd) DESC
      `,
      [since]
    );

    return rows.map((row) => ({
      purpose: row.purpose,
      totalRequests: row.total_requests,
      totalInputTokens: row.total_input_tokens,
      totalOutputTokens: row.total_output_tokens,
      totalTokens: row.total_input_tokens + row.total_output_tokens,
      totalEstimatedCostUsd: round(row.total_estimated_cost_usd),
    }));
  }

  /**
   * Dense daily series for the time-series chart: every day in the window is
   * emitted, including zero-activity days, so the chart's x-axis is evenly
   * spaced instead of silently collapsing gaps. `generate_series` builds the
   * UTC day scaffold server-side; usage rows are bucketed into UTC dates via
   * `AT TIME ZONE 'UTC'` on their epoch-ms timestamp, matching the UTC
   * dates this endpoint has always reported.
   */
  public static async aggregateDaily(days: number): Promise<DailyUsagePoint[]> {
    const now = Date.now();
    const since = now - (days - 1) * 24 * 60 * 60 * 1000;

    const rows = await query<{
      day: string;
      requests: number;
      input_tokens: number;
      output_tokens: number;
      estimated_cost_usd: number;
    }>(
      `
      WITH day_range AS (
        SELECT generate_series(
          (to_timestamp($1 / 1000.0) AT TIME ZONE 'UTC')::date,
          (to_timestamp($2 / 1000.0) AT TIME ZONE 'UTC')::date,
          '1 day'::interval
        )::date AS day
      ),
      bucketed AS (
        SELECT
          (to_timestamp(created_at / 1000.0) AT TIME ZONE 'UTC')::date AS day,
          COUNT(*) AS requests,
          COALESCE(SUM(input_tokens), 0) AS input_tokens,
          COALESCE(SUM(output_tokens), 0) AS output_tokens,
          COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd
        FROM usage
        WHERE created_at >= $1 AND created_at <= $2
        GROUP BY 1
      )
      SELECT
        day_range.day::text AS day,
        COALESCE(bucketed.requests, 0)::int AS requests,
        COALESCE(bucketed.input_tokens, 0)::int AS input_tokens,
        COALESCE(bucketed.output_tokens, 0)::int AS output_tokens,
        COALESCE(bucketed.estimated_cost_usd, 0) AS estimated_cost_usd
      FROM day_range
      LEFT JOIN bucketed ON bucketed.day = day_range.day
      ORDER BY day_range.day
      `,
      [since, now]
    );

    return rows.map((row) => ({
      date: row.day,
      requests: row.requests,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      totalTokens: row.input_tokens + row.output_tokens,
      estimatedCostUsd: round(row.estimated_cost_usd),
    }));
  }

  /**
   * Session-level drill-down: individual logged requests, optionally
   * filtered to one user. `truncated` is now an exact signal (a real COUNT,
   * not a scan-cap guess) - true whenever more matching rows exist beyond
   * this page.
   */
  public static async getUsageRecords(days: number, userId: string | null, limit: number): Promise<UsageRecordsPage> {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const boundedLimit = Math.min(Math.max(limit, 1), MAX_RECORDS_PER_PAGE);

    // 'anonymous' is the client-facing id for NULL user_id rows (see
    // aggregateByUser) - translate it back to an IS NULL filter so drilling
    // into that bucket from the by-user table works. Each query below gets
    // its own correctly-numbered placeholders rather than sharing one
    // clause string across two different param orderings - that's exactly
    // what broke here the first time (the count query doesn't have a
    // `limit` param, so reusing the rows query's `$3` for userId left the
    // count query expecting a `$2` it never received).
    const specificUserId = userId === 'anonymous' ? null : userId;
    const userClauseForRows = userId === null ? '' : userId === 'anonymous' ? 'AND user_id IS NULL' : 'AND user_id = $3';
    const userClauseForCount = userId === null ? '' : userId === 'anonymous' ? 'AND user_id IS NULL' : 'AND user_id = $2';

    const [rows, countRows] = await Promise.all([
      query<UsageRow>(
        `SELECT * FROM usage WHERE created_at >= $1 ${userClauseForRows} ORDER BY created_at DESC LIMIT $2`,
        userId && userId !== 'anonymous' ? [since, boundedLimit, specificUserId] : [since, boundedLimit]
      ),
      query<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM usage WHERE created_at >= $1 ${userClauseForCount}`,
        userId && userId !== 'anonymous' ? [since, specificUserId] : [since]
      ),
    ]);

    const totalMatching = countRows[0]?.count ?? 0;
    return {
      records: rows.map(toUsageRecord),
      totalMatching,
      truncated: totalMatching > boundedLimit,
    };
  }
}

interface UsageRow {
  request_id: string;
  user_id: string | null;
  tenant_id: string | null;
  conversation_id: string | null;
  model: string;
  purpose: UsagePurpose;
  input_tokens: number | null;
  output_tokens: number | null;
  latency_ms: number;
  estimated_cost_usd: number | null;
  created_at: number;
}

function toUsageRecord(row: UsageRow): UsageRecord {
  return {
    requestId: row.request_id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    conversationId: row.conversation_id,
    model: row.model,
    purpose: row.purpose,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    latencyMs: row.latency_ms,
    estimatedCostUsd: row.estimated_cost_usd,
    timestamp: row.created_at,
  };
}
