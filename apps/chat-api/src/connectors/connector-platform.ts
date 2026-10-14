import { ApprovalSummary, ConnectorToolResult } from '@chat-monorepo/shared';
import { ConnectorAdapter } from './connector.types';
import { ConnectorStore, FirestoreConnectorStore } from './connector-store';
import { CredentialVault, KeyProvider } from './credential-vault';
import { ConnectorRegistry, DEFAULT_ADAPTERS } from './connector-registry';
import { ConnectorManager } from './connector-manager';
import { ApprovalService, toApprovalSummary } from './approval-service';
import { AuditService } from './audit-service';
import { ToolExecutor } from './tool-executor';
import { FirestoreRateLimiter, RateLimiter } from './reliability';

/**
 * Composition root for the connector platform. Routes, the LangGraph
 * adapter and the MCP server all go through one instance, so there is exactly
 * one executor, one policy and one audit trail behind every client.
 */
export class ConnectorPlatform {
  readonly registry: ConnectorRegistry;
  readonly vault: CredentialVault;
  readonly manager: ConnectorManager;
  readonly approvals: ApprovalService;
  readonly audit: AuditService;
  readonly executor: ToolExecutor;

  constructor(
    readonly store: ConnectorStore,
    options: { adapters?: ConnectorAdapter[]; rateLimiter?: RateLimiter; keyProvider?: KeyProvider } = {}
  ) {
    this.registry = new ConnectorRegistry(options.adapters ?? DEFAULT_ADAPTERS);
    this.vault = new CredentialVault(store, options.keyProvider);
    this.manager = new ConnectorManager(store, this.vault, this.registry);
    this.approvals = new ApprovalService(store);
    this.audit = new AuditService(store);
    this.executor = new ToolExecutor(store, this.registry, this.manager, this.approvals, this.audit, options.rateLimiter ?? new FirestoreRateLimiter());
  }

  /**
   * The user's decision on an approval card. Approve executes the exact
   * stored action once (fresh authorization re-check inside the executor);
   * reject just closes it. Returns the final approval state and, for an
   * approval, the tool result.
   */
  async decideApproval(
    uid: string,
    approvalId: string,
    decision: 'approve' | 'reject'
  ): Promise<{ ok: true; approval: ApprovalSummary; result?: ConnectorToolResult } | { ok: false; status: number; message: string }> {
    const claimed = await this.approvals.claim(uid, approvalId, decision);
    if (!claimed.ok) return claimed;
    const record = claimed.record;
    const auditBase = {
      ownerUid: uid,
      connectionId: record.connectionId,
      connectorId: record.connectorId,
      toolName: record.toolName,
      riskTier: record.riskTier,
      client: 'settings' as const,
      approvalId,
    };

    if (decision === 'reject') {
      await this.audit.record({ ...auditBase, outcome: 'rejected' });
      const current = await this.approvals.get(uid, approvalId);
      return { ok: true, approval: toApprovalSummary(current ?? { ...record, state: 'rejected' }) };
    }

    await this.audit.record({ ...auditBase, outcome: 'approved' });
    let result: ConnectorToolResult;
    try {
      result = await this.executor.executeApproved(record);
    } catch (error) {
      console.error('[ConnectorPlatform] Approved action threw:', (error as Error).message);
      result = { ok: false, connectorId: record.connectorId, toolName: record.toolName, error: { code: 'INTERNAL', message: 'The action failed unexpectedly.', retryable: false } };
    }
    const url = result.sources?.[0]?.url ?? (result.display?.items?.[0]?.url as string | undefined);
    const finished = await this.approvals.finish(approvalId, {
      ok: result.ok,
      message: result.ok ? result.display?.title ?? 'Done.' : result.error?.message ?? 'The action failed.',
      ...(url ? { url } : {}),
    });
    return { ok: true, approval: toApprovalSummary(finished ?? record), result };
  }

  async disconnect(uid: string, connectionId: string): Promise<boolean> {
    const removed = await this.manager.disconnect(uid, connectionId);
    if (removed) {
      await this.approvals.expireForConnection(uid, connectionId);
      this.executor.forgetConnection(connectionId);
    }
    return removed;
  }
}

let instance: ConnectorPlatform | null = null;

/** Process-wide platform backed by Firestore. Lazily built so importing this never touches the database. */
export function getConnectorPlatform(): ConnectorPlatform {
  if (!instance) instance = new ConnectorPlatform(new FirestoreConnectorStore());
  return instance;
}

/** Test seam. */
export function setConnectorPlatformForTesting(platform: ConnectorPlatform | null): void {
  instance = platform;
}
