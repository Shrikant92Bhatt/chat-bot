import * as crypto from 'crypto';
import { firestore } from '../db/firestore';

/**
 * Per-request token/cost logging, one record per completed chat request.
 * Firestore-backed, following the same collection-per-service pattern as
 * ThreadService/UserRegistryService. There was no usage/cost tracking
 * anywhere in the codebase before this - see orchestration/graph.ts
 * (streamGraphResponse) for where this gets called, once the token usage
 * data for the turn is known.
 */

export interface UsageRecord {
  requestId: string;
  userId: string | null;
  /** No tenant/org model exists in this codebase yet - always null for now,
   *  kept as an explicit field so a future multi-tenant rollout doesn't need
   *  a schema migration. */
  tenantId: string | null;
  conversationId: string | null;
  model: string;
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
  const rate = MODEL_COST_PER_1K[model] || DEFAULT_COST_PER_1K;
  const cost = (inputTokens / 1000) * rate.input + (outputTokens / 1000) * rate.output;
  return Math.round(cost * 1e8) / 1e8; // keep sub-cent precision, avoid float noise
}

export class UsageService {
  private static usageCollection() {
    return firestore.collection('usage');
  }

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

    const fullRecord: UsageRecord = {
      requestId,
      userId: record.userId,
      tenantId: record.tenantId ?? null,
      conversationId: record.conversationId,
      model: record.model,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      latencyMs: record.latencyMs,
      estimatedCostUsd,
      timestamp,
    };

    await this.usageCollection().doc(requestId).set(fullRecord);
    return fullRecord;
  }

  /** Returns the most recent usage records for a given user, newest first. */
  public static async getRecentUsageForUser(uid: string, limit = 50): Promise<UsageRecord[]> {
    const snapshot = await this.usageCollection()
      .where('userId', '==', uid)
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map((doc) => doc.data() as UsageRecord);
  }
}
