/**
 * Multi-connector platform contracts shared by chat-api and chat-client
 * (see docs/MULTI_CONNECTOR_PLATFORM_PLAN.md).
 *
 * Everything in this file crosses the API boundary to the browser, so it must
 * never carry a credential: no access/refresh tokens, authorization codes,
 * client secrets or ciphertext. Those live server-side only, in
 * apps/chat-api/src/connectors/credential-vault.ts.
 */

/** Stable provider ids. A connector without OAuth (market data, paper broker, social drafts) is still a provider. */
export type ConnectorProviderId = 'github' | 'gmail' | 'market_data' | 'social' | 'paper_broker';

/**
 * Risk tiers from the plan's §7 approval policy:
 * 0 local/pure, 1 external read, 2 reversible write, 3 consequential write,
 * 4 financial action (always denied in this release).
 */
export type ConnectorRiskTier = 0 | 1 | 2 | 3 | 4;

/**
 * Coarse capability groups a user toggles per connection. Each maps to the
 * provider scopes it needs, so enabling `write` is what triggers asking the
 * provider for the extra scopes - never up front.
 */
export type ConnectorCapability = 'read' | 'write';

export type ConnectionStatus = 'active' | 'expired' | 'revoked' | 'error';

/** One tool as presented to the browser (settings page / capability list). */
export interface ConnectorToolSummary {
  name: string;
  version: string;
  title: string;
  description: string;
  riskTier: ConnectorRiskTier;
  capability: ConnectorCapability;
  requiresApproval: boolean;
}

export interface ConnectorProviderSummary {
  id: ConnectorProviderId;
  name: string;
  description: string;
  /** True when the provider links an external account via OAuth. */
  requiresOAuth: boolean;
  /** False when the server is missing the config this provider needs (client id/secret, feature flag). */
  available: boolean;
  /** Why `available` is false, safe to show to the user. */
  unavailableReason?: string;
  capabilities: ConnectorCapability[];
  tools: ConnectorToolSummary[];
}

/** A user's linked connection, as the browser sees it - metadata only, never tokens. */
export interface ConnectionSummary {
  id: string;
  providerId: ConnectorProviderId;
  status: ConnectionStatus;
  /** Provider-side account label (GitHub login, Gmail address). */
  accountLabel?: string;
  grantedScopes: string[];
  enabledCapabilities: ConnectorCapability[];
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
  lastCheckedAt?: number;
  lastError?: string;
}

export interface ConnectorSource {
  title: string;
  url?: string;
  retrievedAt?: string;
}

export interface ConnectorToolError {
  code: ConnectorErrorCode;
  message: string;
  retryable: boolean;
}

export type ConnectorErrorCode =
  | 'NOT_CONNECTED'
  | 'CONNECTION_INACTIVE'
  | 'INSUFFICIENT_SCOPE'
  | 'CAPABILITY_DISABLED'
  | 'FEATURE_DISABLED'
  | 'TOOL_NOT_FOUND'
  | 'INVALID_INPUT'
  | 'INVALID_OUTPUT'
  | 'APPROVAL_REQUIRED'
  | 'APPROVAL_INVALID'
  | 'FORBIDDEN_TIER'
  | 'RATE_LIMITED'
  | 'PROVIDER_ERROR'
  | 'PROVIDER_AUTH_FAILED'
  | 'TIMEOUT'
  | 'INTERNAL';

/** The plan's §10 normalized result envelope, returned by every connector tool. */
export interface ConnectorToolResult<T = unknown> {
  ok: boolean;
  connectorId: ConnectorProviderId;
  toolName: string;
  data?: T;
  /** Human-oriented rendering hints; machine data stays in `data`. */
  display?: ConnectorDisplay;
  sources?: ConnectorSource[];
  error?: ConnectorToolError;
  /** Set when the call was turned into an approval request instead of executing. */
  approval?: ApprovalSummary;
  metadata?: {
    durationMs?: number;
    cached?: boolean;
    truncated?: boolean;
  };
}

/**
 * Typed display payload the UI renders as a CONNECTOR_RESULT card. Built by
 * each provider adapter from validated provider data - the UI never infers
 * widgets from untrusted provider HTML.
 */
export interface ConnectorDisplay {
  title: string;
  summary?: string;
  items?: ConnectorDisplayItem[];
  table?: { columns: string[]; rows: Array<Array<string | number | null>> };
  emptyMessage?: string;
}

export interface ConnectorDisplayItem {
  title: string;
  subtitle?: string;
  url?: string;
  /** Short status badge, e.g. "open", "merged", "failure". */
  badge?: string;
  meta?: Array<{ label: string; value: string }>;
}

/** Data for the CONNECTOR_RESULT UI component. */
export interface ConnectorResultCardData {
  connectorId: ConnectorProviderId;
  toolName: string;
  status: 'success' | 'empty' | 'partial' | 'error';
  display?: ConnectorDisplay;
  sources?: ConnectorSource[];
  error?: { code: string; message: string };
  truncated?: boolean;
}

export type ApprovalState = 'pending' | 'approved' | 'rejected' | 'executed' | 'failed' | 'expired';

/** An action awaiting (or past) explicit user approval - the exact action, bound by digest. */
export interface ApprovalSummary {
  id: string;
  connectorId: ConnectorProviderId;
  toolName: string;
  riskTier: ConnectorRiskTier;
  state: ApprovalState;
  /** One-line description of exactly what will happen. */
  summary: string;
  /** Target resource, e.g. "Shrikant92Bhatt/chat-bot#12". */
  target: string;
  /** The material parameters, shown verbatim to the user before approving. */
  details: Array<{ label: string; value: string }>;
  createdAt: number;
  expiresAt: number;
  decidedAt?: number;
  outcome?: { ok: boolean; message: string; url?: string };
}

export interface ConnectorAuditEventSummary {
  id: string;
  connectorId: ConnectorProviderId;
  toolName: string;
  riskTier: ConnectorRiskTier;
  /** Which client invoked the tool. */
  client: 'nexus' | 'mcp' | 'settings';
  outcome: 'success' | 'error' | 'denied' | 'approval_requested' | 'approved' | 'rejected';
  errorCode?: string;
  approvalId?: string;
  durationMs?: number;
  createdAt: number;
}

/** ConfirmationCard action ids carrying this prefix are real server-side approval decisions. */
export const CONNECTOR_APPROVAL_ACTION_PREFIX = 'connector-approval:';
