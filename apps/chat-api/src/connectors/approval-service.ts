import crypto from 'crypto';
import { ApprovalState, ApprovalSummary, ConnectorProviderId, ConnectorRiskTier } from '@chat-monorepo/shared';
import { ConnectionRecord, ToolClient, ToolDefinition } from './connector.types';
import { ConnectorConfig } from './connector-config';
import { COLLECTIONS, ConnectorStore } from './connector-store';
import { canonicalJson, sha256 } from './redact';

/**
 * Exact-action approvals for writes (plan §7).
 *
 * An approval is bound to a digest of {owner, connection, tool, tool version,
 * validated input}. Approving executes exactly the stored input - the model
 * never gets to re-submit "the approved action", so if it wants anything
 * different it has to propose it again and the user sees a new card. Each
 * approval is single-use: the pending→approved transition is atomic, so two
 * clicks, two tabs or two instances can't execute it twice. The stored input
 * (which can contain an email body) is deleted once the action resolves; the
 * digest, summary and outcome remain as the record.
 */

export interface ApprovalRecord extends Record<string, unknown> {
  id: string;
  ownerUid: string;
  connectionId: string;
  connectorId: ConnectorProviderId;
  toolName: string;
  toolVersion: string;
  riskTier: ConnectorRiskTier;
  client: ToolClient;
  state: ApprovalState;
  digest: string;
  /** Validated tool input; removed after the approval resolves. */
  input?: unknown;
  summary: string;
  target: string;
  details: Array<{ label: string; value: string }>;
  createdAt: number;
  expiresAt: number;
  decidedAt?: number;
  outcome?: { ok: boolean; message: string; url?: string };
}

export function approvalDigest(uid: string, connectionId: string, tool: Pick<ToolDefinition, 'name' | 'version'>, input: unknown): string {
  return sha256(canonicalJson({ uid, connectionId, tool: tool.name, version: tool.version, input }));
}

export function toApprovalSummary(r: ApprovalRecord): ApprovalSummary {
  const state: ApprovalState = r.state === 'pending' && r.expiresAt <= Date.now() ? 'expired' : r.state;
  return {
    id: r.id,
    connectorId: r.connectorId,
    toolName: r.toolName,
    riskTier: r.riskTier,
    state,
    summary: r.summary,
    target: r.target,
    details: r.details,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    decidedAt: r.decidedAt,
    outcome: r.outcome,
  };
}

export class ApprovalService {
  constructor(private readonly store: ConnectorStore) {}

  async create(params: {
    uid: string;
    client: ToolClient;
    connection: ConnectionRecord;
    tool: ToolDefinition;
    input: unknown;
  }): Promise<ApprovalRecord> {
    const { uid, connection, tool, input } = params;
    const digest = approvalDigest(uid, connection.id, tool, input);

    // The same proposal twice (model retry, regenerate) reuses the live card instead of stacking duplicates.
    const existing = (await this.store.findBy<ApprovalRecord>(COLLECTIONS.approvals, 'digest', digest))
      .map((r) => r.data)
      .find((r) => r.ownerUid === uid && r.state === 'pending' && r.expiresAt > Date.now());
    if (existing) return existing;

    const description = tool.describeApproval!(input);
    const now = Date.now();
    const record: ApprovalRecord = {
      id: crypto.randomUUID(),
      ownerUid: uid,
      connectionId: connection.id,
      connectorId: connection.providerId,
      toolName: tool.name,
      toolVersion: tool.version,
      riskTier: tool.riskTier,
      client: params.client,
      state: 'pending',
      digest,
      input,
      summary: description.summary,
      target: description.target,
      details: description.details,
      createdAt: now,
      expiresAt: now + ConnectorConfig.approvalTtlMs(),
    };
    await this.store.set(COLLECTIONS.approvals, record.id, record);
    return record;
  }

  async get(uid: string, id: string): Promise<ApprovalRecord | null> {
    const record = await this.store.get<ApprovalRecord>(COLLECTIONS.approvals, id);
    return record && record.ownerUid === uid ? record : null;
  }

  async list(uid: string, state?: ApprovalState): Promise<ApprovalSummary[]> {
    const rows = await this.store.findBy<ApprovalRecord>(COLLECTIONS.approvals, 'ownerUid', uid);
    return rows
      .map((r) => toApprovalSummary(r.data))
      .filter((r) => !state || r.state === state)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 100);
  }

  /**
   * Atomically moves an owned, unexpired, pending approval to approved or
   * rejected. Returns the record as it was when claimed, or a reason why it
   * couldn't be. Only the caller that wins this transition may execute.
   */
  async claim(
    uid: string,
    id: string,
    decision: 'approve' | 'reject'
  ): Promise<{ ok: true; record: ApprovalRecord } | { ok: false; status: number; message: string }> {
    return this.store.transact<ApprovalRecord, { ok: true; record: ApprovalRecord } | { ok: false; status: number; message: string }>(
      COLLECTIONS.approvals,
      id,
      (current) => {
        if (!current || current.ownerUid !== uid) return { next: undefined, result: { ok: false, status: 404, message: 'Approval not found.' } };
        if (current.state !== 'pending') {
          return { next: undefined, result: { ok: false, status: 409, message: `This request was already ${current.state}.` } };
        }
        if (current.expiresAt <= Date.now()) {
          const expired: ApprovalRecord = { ...current, state: 'expired', decidedAt: Date.now() };
          delete expired.input;
          return { next: expired, result: { ok: false, status: 410, message: 'This request expired. Ask again to get a fresh one.' } };
        }
        const next: ApprovalRecord = {
          ...current,
          state: decision === 'approve' ? 'approved' : 'rejected',
          decidedAt: Date.now(),
        };
        if (decision === 'reject') delete next.input;
        return { next, result: { ok: true, record: current } };
      }
    );
  }

  async finish(id: string, outcome: { ok: boolean; message: string; url?: string }): Promise<ApprovalRecord | null> {
    return this.store.transact<ApprovalRecord, ApprovalRecord | null>(COLLECTIONS.approvals, id, (current) => {
      if (!current) return { next: undefined, result: null };
      const next: ApprovalRecord = { ...current, state: outcome.ok ? 'executed' : 'failed', outcome };
      delete next.input;
      return { next, result: next };
    });
  }

  /** Expires every pending approval on a connection (used on disconnect). */
  async expireForConnection(uid: string, connectionId: string): Promise<void> {
    const rows = await this.store.findBy<ApprovalRecord>(COLLECTIONS.approvals, 'ownerUid', uid);
    await Promise.allSettled(
      rows
        .filter((r) => r.data.connectionId === connectionId && r.data.state === 'pending')
        .map((r) => {
          const next: ApprovalRecord = { ...r.data, state: 'expired', decidedAt: Date.now() };
          delete next.input;
          return this.store.set(COLLECTIONS.approvals, r.id, next);
        })
    );
  }
}
