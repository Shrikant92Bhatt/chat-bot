import { ConnectorErrorCode } from '@chat-monorepo/shared';
import { ConnectionRecord, ToolClient, ToolDefinition } from './connector.types';
import { ConnectorConfig } from './connector-config';

/**
 * Deterministic authorization for one tool invocation (plan §3: "the model
 * may propose tool calls; deterministic server-side policy decides whether
 * they are allowed"). Pure - no I/O - so every rule is unit-testable and the
 * same function runs at proposal time AND again immediately before an
 * approved write executes.
 */

export interface PolicyInput {
  uid: string;
  client: ToolClient;
  tool: ToolDefinition;
  /** The caller's connection for this tool's provider, already loaded by owner. */
  connection: ConnectionRecord | null;
  /** True once credentials were successfully loaded/refreshed (OAuth providers only). */
  credentialsValid: boolean;
  providerRequiresOAuth: boolean;
}

export type PolicyDecision = { allowed: true } | { allowed: false; code: ConnectorErrorCode; message: string };

const deny = (code: ConnectorErrorCode, message: string): PolicyDecision => ({ allowed: false, code, message });

export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  const { tool, connection, client } = input;

  if (!ConnectorConfig.enabled()) return deny('FEATURE_DISABLED', 'Connectors are disabled on this server.');

  // Tier 4 (live financial actions) is out of scope for this release, full stop.
  if (tool.riskTier >= 4) return deny('FORBIDDEN_TIER', 'Live financial actions are not available.');

  if (tool.riskTier >= 2 && !ConnectorConfig.writesEnabled()) {
    return deny('FEATURE_DISABLED', 'Write actions are disabled on this server.');
  }

  // The external MCP client (ChatGPT) gets the curated read-only surface only.
  if (client === 'mcp' && (!tool.mcpExposed || tool.capability !== 'read' || tool.riskTier >= 2)) {
    return deny('TOOL_NOT_FOUND', 'This tool is not available to this client.');
  }

  if (!connection) return deny('NOT_CONNECTED', 'This account is not connected. Connect it in Settings → Connectors.');
  // Defense in depth: the loader already filters by owner.
  if (connection.ownerUid !== input.uid) return deny('NOT_CONNECTED', 'This account is not connected.');
  if (connection.status !== 'active') {
    return deny('CONNECTION_INACTIVE', `The connection is ${connection.status}. Reconnect it in Settings → Connectors.`);
  }
  if (!connection.enabledCapabilities.includes(tool.capability)) {
    return deny('CAPABILITY_DISABLED', `The "${tool.capability}" capability is turned off for this connection.`);
  }

  const missing = tool.requiredScopes.filter((s) => !connection.grantedScopes.includes(s));
  if (missing.length > 0) {
    return deny('INSUFFICIENT_SCOPE', 'This connection was not granted the permission this action needs. Reconnect to grant it.');
  }

  if (input.providerRequiresOAuth && !input.credentialsValid) {
    return deny('PROVIDER_AUTH_FAILED', 'The provider authorization has expired or was revoked. Reconnect it in Settings → Connectors.');
  }

  return { allowed: true };
}
