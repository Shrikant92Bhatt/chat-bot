import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConnectorResultCardData } from '@chat-monorepo/shared';
import { safeExternalUrl } from '../../../services/connector.service';

const CONNECTOR_NAMES: Record<string, string> = {
  github: 'GitHub',
  gmail: 'Gmail',
  market_data: 'Market data',
  paper_broker: 'Paper trading',
  social: 'Social drafts',
};

/** Error codes the user fixes in Settings → Connectors rather than by retrying. */
const RECONNECT_CODES = new Set(['NOT_CONNECTED', 'CONNECTION_INACTIVE', 'INSUFFICIENT_SCOPE', 'CAPABILITY_DISABLED', 'PROVIDER_AUTH_FAILED']);

/**
 * Renders a CONNECTOR_RESULT - a connector tool's normalized, server-built
 * result (see apps/chat-api/src/orchestration/ui-tool-adapter.ts). Covers
 * success, empty, partial (truncated) and error states. All text is bound via
 * interpolation; links are restricted to http(s).
 */
@Component({
  selector: 'app-ui-connector-result',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './connector-result.component.html',
  host: { style: 'display: contents' },
})
export class ConnectorResultComponent {
  @Input({ required: true }) data!: ConnectorResultCardData;

  public readonly safeUrl = safeExternalUrl;

  public get connectorName(): string {
    return CONNECTOR_NAMES[this.data.connectorId] ?? this.data.connectorId;
  }

  public get needsReconnect(): boolean {
    return !!this.data.error && RECONNECT_CODES.has(this.data.error.code);
  }

  public get isEmpty(): boolean {
    const d = this.data.display;
    return !this.data.error && !(d?.items?.length || d?.table?.rows?.length);
  }
}
