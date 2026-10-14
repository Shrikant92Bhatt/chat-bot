import { Injectable, signal } from '@angular/core';
import {
  ApprovalSummary,
  ConnectionSummary,
  ConnectorAuditEventSummary,
  ConnectorCapability,
  ConnectorProviderSummary,
  ConnectorToolResult,
} from '@chat-monorepo/shared';
import { AuthService } from './auth.service';
import { getApiBaseUrl } from '../core/runtime-config';

export interface McpGrant {
  id: string;
  clientId: string;
  clientName: string;
  scope: string;
  createdAt: number;
  lastUsedAt?: number;
}

export interface McpStatus {
  enabled: boolean;
  endpoint?: string;
  reason?: string;
}

export interface McpConsentDetails {
  clientName: string;
  redirectHost: string;
  scopes: string[];
}

/** Only http(s) links from provider data are ever rendered as hrefs. */
export function safeExternalUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/** User-facing copy for the OAuth callback's coarse error codes (see connector.routes.ts). */
export function connectorErrorMessage(code: string | null): string {
  switch (code) {
    case 'InvalidState':
      return 'That connection link expired or was opened in a different browser session. Please try connecting again.';
    case 'ProviderDenied':
      return 'Access was not granted at the provider.';
    case 'TokenExchangeFailed':
      return 'The provider did not complete the connection. Please try again.';
    case 'Unavailable':
      return 'This connector is not available on this server right now.';
    default:
      return 'Something went wrong while connecting. Please try again.';
  }
}

/**
 * Client for /api/v1/connectors and /api/v1/mcp-oauth (connector settings,
 * approvals, audit history, ChatGPT access). Holds metadata only - the server
 * never sends tokens to the browser.
 */
@Injectable({ providedIn: 'root' })
export class ConnectorService {
  public providers = signal<ConnectorProviderSummary[]>([]);
  public connections = signal<ConnectionSummary[]>([]);
  public pendingApprovals = signal<ApprovalSummary[]>([]);
  public audit = signal<ConnectorAuditEventSummary[]>([]);
  public enabled = signal<boolean>(false);
  public writesEnabled = signal<boolean>(false);
  public mcpStatus = signal<McpStatus | null>(null);
  public mcpGrants = signal<McpGrant[]>([]);
  public isLoading = signal<boolean>(false);
  public error = signal<string | null>(null);
  /** Provider id with an in-flight action (connect/check/disconnect), for button spinners. */
  public busyProvider = signal<string | null>(null);

  constructor(private authService: AuthService) {}

  private get base() {
    return `${getApiBaseUrl()}/api/v1/connectors`;
  }

  private get mcpBase() {
    return `${getApiBaseUrl()}/api/v1/mcp-oauth`;
  }

  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.authService.getIdToken()}` };
    if (init.body) headers['Content-Type'] = 'application/json';
    // Default credentials ('same-origin'): the OAuth browser-binding cookie set by
    // /connect is stored when the API shares the app's origin (Vercel, dev proxy).
    const response = await fetch(url, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
    if (response.status === 401) {
      this.authService.notifySessionExpired();
      throw new Error('Your session has expired. Please sign in again.');
    }
    const data = response.status === 204 ? ({} as T) : await response.json().catch(() => ({}));
    if (!response.ok) {
      const body = data as { message?: string; error_description?: string; error?: string };
      throw new Error(body.message || body.error_description || body.error || `Request failed (${response.status}).`);
    }
    return data as T;
  }

  public connectionFor(providerId: string): ConnectionSummary | undefined {
    return this.connections().find((c) => c.providerId === providerId);
  }

  public async loadAll(): Promise<void> {
    if (!this.authService.userSignal()) return;
    this.isLoading.set(true);
    this.error.set(null);
    try {
      const [providers, connections, approvals, audit, mcpStatus] = await Promise.all([
        this.request<{ enabled: boolean; writesEnabled: boolean; providers: ConnectorProviderSummary[] }>(`${this.base}/providers`),
        this.request<{ connections: ConnectionSummary[] }>(`${this.base}/connections`),
        this.request<{ approvals: ApprovalSummary[] }>(`${this.base}/approvals?state=pending`),
        this.request<{ events: ConnectorAuditEventSummary[] }>(`${this.base}/audit`),
        fetch(`${this.mcpBase}/status`).then((r) => (r.ok ? (r.json() as Promise<McpStatus>) : null)).catch(() => null),
      ]);
      this.enabled.set(providers.enabled);
      this.writesEnabled.set(providers.writesEnabled);
      this.providers.set(providers.providers);
      this.connections.set(connections.connections);
      this.pendingApprovals.set(approvals.approvals);
      this.audit.set(audit.events);
      this.mcpStatus.set(mcpStatus);
      if (mcpStatus?.enabled) {
        const grants = await this.request<{ grants: McpGrant[] }>(`${this.mcpBase}/grants`).catch(() => ({ grants: [] }));
        this.mcpGrants.set(grants.grants);
      } else {
        this.mcpGrants.set([]);
      }
    } catch (e) {
      this.error.set((e as Error).message || 'Failed to load connectors.');
    } finally {
      this.isLoading.set(false);
    }
  }

  /** Starts linking. OAuth providers navigate the whole window to the provider; built-ins connect in place. */
  public async connect(providerId: string, capabilities?: ConnectorCapability[]): Promise<void> {
    this.busyProvider.set(providerId);
    this.error.set(null);
    try {
      const result = await this.request<{ authorizeUrl?: string; connection?: ConnectionSummary }>(`${this.base}/${encodeURIComponent(providerId)}/connect`, {
        method: 'POST',
        body: JSON.stringify(capabilities ? { capabilities } : {}),
      });
      if (result.authorizeUrl) {
        window.location.assign(result.authorizeUrl);
        return;
      }
      await this.loadAll();
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busyProvider.set(null);
    }
  }

  public async setCapabilities(connection: ConnectionSummary, capabilities: ConnectorCapability[]): Promise<void> {
    this.busyProvider.set(connection.providerId);
    this.error.set(null);
    try {
      const result = await this.request<{ authorizeUrl?: string; connection?: ConnectionSummary }>(`${this.base}/connections/${connection.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabledCapabilities: capabilities }),
      });
      if (result.authorizeUrl) {
        // Enabling this needs extra provider permission - incremental consent.
        window.location.assign(result.authorizeUrl);
        return;
      }
      await this.loadAll();
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busyProvider.set(null);
    }
  }

  public async check(connection: ConnectionSummary): Promise<void> {
    this.busyProvider.set(connection.providerId);
    try {
      await this.request(`${this.base}/connections/${connection.id}/check`, { method: 'POST' });
      await this.loadAll();
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busyProvider.set(null);
    }
  }

  public async disconnect(connection: ConnectionSummary): Promise<void> {
    this.busyProvider.set(connection.providerId);
    try {
      await this.request(`${this.base}/connections/${connection.id}`, { method: 'DELETE' });
      await this.loadAll();
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busyProvider.set(null);
    }
  }

  /** Fresh server-side view of an approval - the approval card renders this, never model text. */
  public async getApproval(id: string): Promise<ApprovalSummary> {
    const data = await this.request<{ approval: ApprovalSummary }>(`${this.base}/approvals/${encodeURIComponent(id)}`);
    return data.approval;
  }

  public async decide(id: string, decision: 'approve' | 'reject'): Promise<{ approval: ApprovalSummary; result?: ConnectorToolResult }> {
    const data = await this.request<{ approval: ApprovalSummary; result?: ConnectorToolResult }>(
      `${this.base}/approvals/${encodeURIComponent(id)}/decision`,
      { method: 'POST', body: JSON.stringify({ decision }) }
    );
    this.pendingApprovals.update((list) => list.filter((a) => a.id !== id));
    return data;
  }

  // ---------- ChatGPT / MCP access ----------

  public async getMcpConsent(request: string): Promise<McpConsentDetails> {
    return this.request<McpConsentDetails>(`${this.mcpBase}/consent?request=${encodeURIComponent(request)}`);
  }

  public async decideMcpConsent(request: string, decision: 'approve' | 'deny'): Promise<string> {
    const data = await this.request<{ redirectUrl: string }>(`${this.mcpBase}/consent`, {
      method: 'POST',
      body: JSON.stringify({ request, decision }),
    });
    return data.redirectUrl;
  }

  public async revokeMcpGrant(id: string): Promise<void> {
    await this.request(`${this.mcpBase}/grants/${encodeURIComponent(id)}`, { method: 'DELETE' });
    this.mcpGrants.update((list) => list.filter((g) => g.id !== id));
  }
}
