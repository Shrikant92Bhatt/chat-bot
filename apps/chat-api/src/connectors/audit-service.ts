import crypto from 'crypto';
import { ConnectorAuditEventSummary, ConnectorProviderId, ConnectorRiskTier } from '@chat-monorepo/shared';
import { COLLECTIONS, ConnectorStore } from './connector-store';
import { scrubSecrets } from './redact';

/**
 * Append-only audit trail of connector activity (plan §11
 * connectorAuditEvents). Records who/what/when/outcome plus redacted shape
 * metadata only - never tool inputs, outputs, email bodies or tokens.
 * Writes are best-effort: an audit hiccup is logged, never allowed to fail
 * the user's action (the approval record itself is the durable record of
 * any write).
 */

export interface AuditEventInput {
  ownerUid: string;
  connectionId?: string;
  connectorId: ConnectorProviderId;
  toolName: string;
  riskTier: ConnectorRiskTier;
  client: ConnectorAuditEventSummary['client'];
  outcome: ConnectorAuditEventSummary['outcome'];
  errorCode?: string;
  approvalId?: string;
  durationMs?: number;
  /** Redacted metadata: field shapes, digests, counts. */
  meta?: Record<string, string | number | boolean>;
}

export type AuditEventRecord = AuditEventInput & { id: string; createdAt: number } & Record<string, unknown>;

/** Retention for audit rows - older ones are pruned lazily when the user's history is read. */
const AUDIT_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

export class AuditService {
  constructor(private readonly store: ConnectorStore) {}

  async record(event: AuditEventInput): Promise<void> {
    const record: AuditEventRecord = {
      ...event,
      ...(event.meta ? { meta: Object.fromEntries(Object.entries(event.meta).map(([k, v]) => [k, typeof v === 'string' ? scrubSecrets(v) : v])) } : {}),
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    };
    try {
      await this.store.set(COLLECTIONS.audit, record.id, record);
    } catch (error) {
      console.error('[AuditService] Failed to write audit event:', (error as Error).message);
    }
  }

  async listForUser(uid: string, limit = 100): Promise<ConnectorAuditEventSummary[]> {
    const rows = await this.store.findBy<AuditEventRecord>(COLLECTIONS.audit, 'ownerUid', uid);
    const cutoff = Date.now() - AUDIT_RETENTION_MS;
    const expired = rows.filter((r) => r.data.createdAt < cutoff);
    await Promise.allSettled(expired.map((r) => this.store.delete(COLLECTIONS.audit, r.id)));
    return rows
      .map((r) => r.data)
      .filter((r) => r.createdAt >= cutoff)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((r) => ({
        id: r.id,
        connectorId: r.connectorId,
        toolName: r.toolName,
        riskTier: r.riskTier,
        client: r.client,
        outcome: r.outcome,
        errorCode: r.errorCode,
        approvalId: r.approvalId,
        durationMs: r.durationMs,
        createdAt: r.createdAt,
      }));
  }

  /** Account-deletion path: removes every audit row the user owns. (Disconnecting keeps them for accountability.) */
  async deleteForUser(uid: string): Promise<void> {
    const rows = await this.store.findBy<AuditEventRecord>(COLLECTIONS.audit, 'ownerUid', uid);
    await Promise.allSettled(rows.map((r) => this.store.delete(COLLECTIONS.audit, r.id)));
  }
}
