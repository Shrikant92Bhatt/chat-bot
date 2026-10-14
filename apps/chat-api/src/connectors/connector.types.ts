import { z } from 'zod';
import {
  ConnectorCapability,
  ConnectorDisplay,
  ConnectorProviderId,
  ConnectorRiskTier,
  ConnectorSource,
} from '@chat-monorepo/shared';
import { ConnectorStore } from './connector-store';
import { ProviderCredentials } from './credential-vault';

/**
 * Provider-independent connector contract (plan §5).
 *
 * A provider adapter is mostly declarative: OAuth endpoints + a list of
 * ToolDefinitions. Everything cross-cutting - ownership, scopes, approvals,
 * validation, timeouts, retries, truncation, audit - is enforced once in
 * tool-executor.ts, so an adapter can't forget it and orchestration code
 * (LangGraph, the MCP server) depends only on the tool contract, never on a
 * provider SDK.
 */

/** Passed to a tool's `run` - the only things a provider call may touch. */
export interface ToolRunContext {
  uid: string;
  connectionId: string;
  /** Present for OAuth providers; already refreshed and checked by the executor. */
  credentials?: ProviderCredentials;
  store: ConnectorStore;
  /** Aborted when the tool's deadline passes. Pass it to every fetch. */
  signal: AbortSignal;
  /** Set for approved writes - forward to the provider where it supports one. */
  idempotencyKey?: string;
}

export interface ToolRunOutput<T = unknown> {
  data: T;
  display?: ConnectorDisplay;
  sources?: ConnectorSource[];
  /** The adapter already dropped items to stay within its own limits. */
  truncated?: boolean;
}

/** What the user is shown before approving a write - computed from the validated input only. */
export interface ApprovalDescription {
  summary: string;
  target: string;
  details: Array<{ label: string; value: string }>;
}

export interface ToolDefinition<I = any, O = any> {
  /** Stable, globally unique name - also the LangChain/MCP tool name. */
  name: string;
  version: string;
  title: string;
  /** Model-facing description. */
  description: string;
  inputSchema: z.ZodType<I>;
  /** Validates the adapter's own output before it reaches the model or UI. */
  outputSchema: z.ZodType<O>;
  riskTier: ConnectorRiskTier;
  capability: ConnectorCapability;
  /** Provider scopes this tool needs; checked against the connection's granted scopes on every call. */
  requiredScopes: string[];
  requiresApproval: boolean;
  timeoutMs: number;
  /** Attempts for transient failures. Writes are always forced to 1 by the executor. */
  maxAttempts: number;
  /** True when the provider call is safe to repeat (reads, or writes with provider idempotency keys). */
  idempotent: boolean;
  /** Cache freshness in ms; 0 = never cached. Cache entries are per user + connection. */
  cacheTtlMs: number;
  /** Serialized-size budget for this tool's result; falls back to the global CONNECTOR_MAX_RESULT_CHARS. */
  maxResultChars?: number;
  /** Eligible for the remote MCP server (ChatGPT). Only read-only tools may set this. */
  mcpExposed?: boolean;
  /** Required when `requiresApproval` - what the approval card shows. */
  describeApproval?: (input: I) => ApprovalDescription;
  run: (ctx: ToolRunContext, input: I) => Promise<ToolRunOutput<O>>;
}

export interface OAuthProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  clientId: () => string;
  clientSecret: () => string;
  /** Space-separated scopes to request for the given capabilities. */
  scopesFor: (capabilities: ConnectorCapability[]) => string[];
  usePkce: boolean;
  /** Extra authorize-URL parameters (e.g. Google's access_type=offline). */
  extraAuthorizeParams?: Record<string, string>;
  /**
   * Scopes actually granted, when the token response doesn't say (GitHub
   * Apps report none - their permissions live on the installation).
   */
  grantedScopesFallback?: (requested: string[]) => string[];
  /** Resolves a display label (login / email) with a fresh token - also the "connection check". */
  fetchAccountLabel: (accessToken: string, signal: AbortSignal) => Promise<string>;
  /** Best-effort provider-side revocation on disconnect. */
  revoke?: (credentials: ProviderCredentials, signal: AbortSignal) => Promise<void>;
}

export interface ConnectorAdapter {
  id: ConnectorProviderId;
  name: string;
  description: string;
  /** Non-null when this provider links an external account. */
  oauth: OAuthProviderConfig | null;
  /** Null when usable, otherwise a user-safe reason (missing client id, provider disabled, ...). */
  unavailableReason: () => string | null;
  /** Capabilities enabled by default on a fresh connection. */
  defaultCapabilities: ConnectorCapability[];
  tools: ToolDefinition[];
}

/** Stored connection metadata. Never contains secrets - those are in the vault. */
export interface ConnectionRecord extends Record<string, unknown> {
  id: string;
  ownerUid: string;
  providerId: ConnectorProviderId;
  status: 'active' | 'expired' | 'revoked' | 'error';
  accountLabel?: string;
  grantedScopes: string[];
  enabledCapabilities: ConnectorCapability[];
  hasCredentials: boolean;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
  lastCheckedAt?: number;
  lastError?: string;
}

/** Who is calling a tool - drives audit attribution and per-client policy. */
export type ToolClient = 'nexus' | 'mcp' | 'settings';

export interface ExecutionContext {
  uid: string;
  client: ToolClient;
}

export class ProviderHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean
  ) {
    super(message);
  }
}
