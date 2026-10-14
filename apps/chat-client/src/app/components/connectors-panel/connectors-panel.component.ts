import { Component, Input, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConnectionSummary, ConnectorCapability, ConnectorProviderSummary } from '@chat-monorepo/shared';
import { ConnectorService } from '../../services/connector.service';
import { AuthService } from '../../services/auth.service';

/**
 * Settings → Connectors (plan §10): available providers and their tools,
 * connect/disconnect, granted scopes and last check, per-connection
 * capability toggles (enabling "write" may send the user back to the
 * provider for the extra permission), pending approvals, redacted history,
 * and ChatGPT (MCP) access grants with revoke.
 */
@Component({
  selector: 'app-connectors-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './connectors-panel.component.html',
})
export class ConnectorsPanelComponent {
  /** Shown once at the top, e.g. the result of an OAuth round-trip. */
  @Input() notice: { kind: 'success' | 'error'; message: string } | null = null;

  public section = signal<'accounts' | 'approvals' | 'history' | 'chatgpt'>('accounts');
  public expanded = signal<string | null>(null);

  private loadedFor: string | null = null;

  constructor(
    public connectorService: ConnectorService,
    authService: AuthService
  ) {
    // Load once the session is known - after an OAuth return the panel can
    // open before the stored session has been restored.
    effect(() => {
      const uid = authService.userSignal()?.uid ?? null;
      if (uid && uid !== this.loadedFor) {
        this.loadedFor = uid;
        void this.connectorService.loadAll();
      }
    });
  }

  public connection(provider: ConnectorProviderSummary): ConnectionSummary | undefined {
    return this.connectorService.connectionFor(provider.id);
  }

  public hasCapability(connection: ConnectionSummary, capability: ConnectorCapability): boolean {
    return connection.enabledCapabilities.includes(capability);
  }

  public toggleCapability(connection: ConnectionSummary, capability: ConnectorCapability): void {
    const next = this.hasCapability(connection, capability)
      ? connection.enabledCapabilities.filter((c) => c !== capability)
      : [...connection.enabledCapabilities, capability];
    void this.connectorService.setCapabilities(connection, next.length ? next : ['read']);
  }

  public toggleExpanded(id: string): void {
    this.expanded.set(this.expanded() === id ? null : id);
  }

  public statusClass(status: string): string {
    switch (status) {
      case 'active':
        return 'text-emerald-400';
      case 'expired':
      case 'revoked':
        return 'text-amber-300';
      default:
        return 'text-accentRose';
    }
  }

  public tierLabel(tier: number): string {
    return ['Local', 'Read', 'Write (approval)', 'Consequential (approval)', 'Financial (disabled)'][tier] ?? String(tier);
  }

  public async decide(id: string, decision: 'approve' | 'reject'): Promise<void> {
    try {
      await this.connectorService.decide(id, decision);
      await this.connectorService.loadAll();
    } catch (e) {
      this.connectorService.error.set((e as Error).message);
    }
  }

  public async revokeGrant(id: string): Promise<void> {
    try {
      await this.connectorService.revokeMcpGrant(id);
    } catch (e) {
      this.connectorService.error.set((e as Error).message);
    }
  }
}
