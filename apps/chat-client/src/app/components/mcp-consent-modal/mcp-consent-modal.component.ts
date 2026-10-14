import { Component, EventEmitter, Input, Output, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth.service';
import { ConnectorService, McpConsentDetails } from '../../services/connector.service';

/**
 * Consent screen for an external MCP client (e.g. ChatGPT) asking for
 * read-only access to the user's connected accounts. Reached via the MCP
 * authorization endpoint's redirect (`/?mcpConsent=<signed request>`); the
 * user must be signed in to NexusAI, and approval is sent with their normal
 * app session - the external client never sees that session.
 */
@Component({
  selector: 'app-mcp-consent-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './mcp-consent-modal.component.html',
})
export class McpConsentModalComponent {
  @Input({ required: true }) request!: string;
  @Output() closed = new EventEmitter<void>();

  public details = signal<McpConsentDetails | null>(null);
  public error = signal<string | null>(null);
  public busy = signal<boolean>(false);

  private requested = false;

  constructor(
    public authService: AuthService,
    private connectorService: ConnectorService
  ) {
    // Loads as soon as the user is signed in - including when they sign in
    // only after landing here from the external client.
    effect(() => {
      if (this.authService.userSignal() && !this.requested) {
        this.requested = true;
        void this.load();
      }
    });
  }

  private async load(): Promise<void> {
    try {
      this.details.set(await this.connectorService.getMcpConsent(this.request));
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  public async decide(decision: 'approve' | 'deny'): Promise<void> {
    this.busy.set(true);
    try {
      const redirectUrl = await this.connectorService.decideMcpConsent(this.request, decision);
      window.location.assign(redirectUrl);
    } catch (e) {
      this.error.set((e as Error).message);
      this.busy.set(false);
    }
  }
}
