import * as crypto from 'crypto';
import { query } from '../db/postgres';
import { ModelConfigService } from './model-config.service';

/**
 * Per-request token/cost logging, one row per completed chat request. See
 * orchestration/graph.ts (streamGraphResponse) for where this gets called,
 * once the token usage data for the turn is known.
 */

/**
 * What the logged LLM call was FOR, not just which model ran it. Without
 * this, once the sidecar calls below started being logged too, their cost
 * would silently blend into whatever model the user picked as "the cost of
 * chatting" - e.g. a user on Claude via OpenRouter would show cost against
 * claude-sonnet that actually included three unrelated Gemini Flash calls
 * (summarization/memory/suggestions) that have nothing to do with Claude.
 * 'chat' also covers the research planner's usage - it's summed into the
 * same request/turn total in graph.ts because it's still spent answering
 * THIS message, unlike the other three which serve future turns or UI sugar.
 */
export type UsagePurpose = 'chat' | 'summarization' | 'memory_extraction' | 'follow_up_suggestions';

export interface UsageRecord {
  requestId: string;
  userId: string | null;
  /** No tenant/org model exists in this codebase yet - always null for now,
   *  kept as an explicit field so a future multi-tenant rollout doesn't need
   *  a schema migration. */
  tenantId: string | null;
  conversationId: string | null;
  model: string;
  purpose: UsagePurpose;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Wall-clock duration of the LLM call, in milliseconds. */
  latencyMs: number;
  /** Rough USD estimate derived from inputTokens/outputTokens and
   *  MODEL_COST_PER_1K below. Null when token counts weren't available
   *  (never fabricated from a guess). */
  estimatedCostUsd: number | null;
  timestamp: number;
}

/**
 * Rough $ per 1,000 tokens, by this app's model ID (see AIModelType /
 * OPENROUTER_MODEL_SLUG_MAP in llm/client.ts). Sourced from published
 * list pricing at time of writing - NOT pulled live from OpenRouter, so
 * treat as an estimate for relative cost tracking, not a billing-accurate
 * figure. Re-check https://openrouter.ai/models if these numbers need to
 * be trusted for real budgeting.
 */
const MODEL_COST_PER_1K: Record<string, { input: number; output: number }> = {
  'gemini-flash-latest': { input: 0.00015, output: 0.0006 },
  'gemini-pro-latest': { input: 0.00125, output: 0.005 },
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'claude-sonnet': { input: 0.003, output: 0.015 },
  'llama-4-maverick': { input: 0.0002, output: 0.0008 },
  grok: { input: 0.003, output: 0.015 },
  'omniroute-default': { input: 0.00015, output: 0.0006 },
};

/** Fallback rate for any model ID not in the table above, so cost is still
 *  a real (if rougher) number rather than silently missing. */
const DEFAULT_COST_PER_1K = { input: 0.001, output: 0.003 };

export function estimateCostUsd(model: string, inputTokens: number | null, outputTokens: number | null): number | null {
  if (inputTokens == null || outputTokens == null) return null;
  const rate = ModelConfigService.getCostRate(model);
  const cost = (inputTokens / 1000) * rate.input + (outputTokens / 1000) * rate.output;
  return Math.round(cost * 1e8) / 1e8; // keep sub-cent precision, avoid float noise
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

export class UsageService {
  /**
   * Logs one usage record. Fire-and-forget from the caller's perspective is
   * NOT used here - callers await this, but a logging failure must never
   * break the chat response itself (see the try/catch at the call site in
   * orchestration/graph.ts).
   */
  public static async logUsage(
    record: Omit<UsageRecord, 'requestId' | 'timestamp' | 'estimatedCostUsd'> & { requestId?: string }
  ): Promise<UsageRecord> {
    const requestId = record.requestId || crypto.randomUUID();
    const timestamp = Date.now();
    const estimatedCostUsd = estimateCostUsd(record.model, record.inputTokens, record.outputTokens);

    await query(
      `
      INSERT INTO usage (request_id, user_id, tenant_id, conversation_id, model, purpose, input_tokens, output_tokens, latency_ms, estimated_cost_usd, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        requestId,
        record.userId,
        record.tenantId ?? null,
        record.conversationId,
        record.model,
        record.purpose,
        record.inputTokens,
        record.outputTokens,
        record.latencyMs,
        estimatedCostUsd,
        timestamp,
      ]
    );

    return {
      requestId,
      userId: record.userId,
      tenantId: record.tenantId ?? null,
      conversationId: record.conversationId,
      model: record.model,
      purpose: record.purpose,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      latencyMs: record.latencyMs,
      estimatedCostUsd,
      timestamp,
    };
  }

  /** Returns the most recent usage records for a given user, newest first. */
  public static async getRecentUsageForUser(uid: string, limit = 50): Promise<UsageRecord[]> {
    const rows = await query<UsageRow>('SELECT * FROM usage WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2', [uid, limit]);
    return rows.map(toUsageRecord);
  }
}
