import { ConnectorProviderId, ConnectorProviderSummary, ConnectorToolSummary } from '@chat-monorepo/shared';
import { ConnectorAdapter, ToolDefinition } from './connector.types';
import { ConnectorConfig } from './connector-config';
import { EnvKeyProvider } from './credential-vault';
import { githubConnector } from './providers/github/github.connector';
import { gmailConnector } from './providers/google/gmail.connector';
import { marketDataConnector } from './providers/market-data/market-data.connector';
import { socialConnector } from './providers/social/social.connector';
import { paperBrokerConnector } from './providers/brokers/paper-broker.connector';

/**
 * The one list of connectors and their tools (plan §5). Tool names are
 * globally unique - the registry refuses to start with a duplicate, since a
 * name collision would let one provider's tool shadow another's.
 */
export class ConnectorRegistry {
  private readonly adapters = new Map<ConnectorProviderId, ConnectorAdapter>();
  private readonly tools = new Map<string, { adapter: ConnectorAdapter; tool: ToolDefinition }>();

  constructor(adapters: ConnectorAdapter[]) {
    for (const adapter of adapters) {
      if (this.adapters.has(adapter.id)) throw new Error(`Duplicate connector id ${adapter.id}`);
      this.adapters.set(adapter.id, adapter);
      for (const tool of adapter.tools) {
        if (this.tools.has(tool.name)) throw new Error(`Duplicate connector tool name ${tool.name}`);
        if (tool.requiresApproval && !tool.describeApproval) throw new Error(`${tool.name} requires approval but has no describeApproval`);
        if (tool.mcpExposed && tool.capability !== 'read') throw new Error(`${tool.name}: only read tools may be MCP-exposed`);
        this.tools.set(tool.name, { adapter, tool });
      }
    }
  }

  getAdapter(id: string): ConnectorAdapter | undefined {
    return this.adapters.get(id as ConnectorProviderId);
  }

  listAdapters(): ConnectorAdapter[] {
    return [...this.adapters.values()];
  }

  getTool(name: string): { adapter: ConnectorAdapter; tool: ToolDefinition } | undefined {
    return this.tools.get(name);
  }

  isConnectorTool(name: string): boolean {
    return this.tools.has(name);
  }

  /** Server-wide reason a provider can't be used right now, or null. */
  unavailableReason(adapter: ConnectorAdapter): string | null {
    if (!ConnectorConfig.enabled()) return 'Connectors are disabled on this server.';
    if (adapter.oauth && !EnvKeyProvider.isConfigured()) return 'Secure credential storage is not configured on this server.';
    if (adapter.oauth && !ConnectorConfig.publicBaseUrl()) return 'PUBLIC_BASE_URL is not configured on this server.';
    return adapter.unavailableReason();
  }

  toToolSummary(tool: ToolDefinition): ConnectorToolSummary {
    return {
      name: tool.name,
      version: tool.version,
      title: tool.title,
      description: tool.description,
      riskTier: tool.riskTier,
      capability: tool.capability,
      requiresApproval: tool.requiresApproval,
    };
  }

  listProviderSummaries(): ConnectorProviderSummary[] {
    return this.listAdapters().map((adapter) => {
      const reason = this.unavailableReason(adapter);
      return {
        id: adapter.id,
        name: adapter.name,
        description: adapter.description,
        requiresOAuth: adapter.oauth !== null,
        available: reason === null,
        ...(reason ? { unavailableReason: reason } : {}),
        capabilities: [...new Set(adapter.tools.map((t) => t.capability))],
        tools: adapter.tools.map((t) => this.toToolSummary(t)),
      };
    });
  }
}

export const DEFAULT_ADAPTERS: ConnectorAdapter[] = [
  githubConnector,
  gmailConnector,
  marketDataConnector,
  paperBrokerConnector,
  socialConnector,
];
