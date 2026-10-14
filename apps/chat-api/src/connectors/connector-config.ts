/**
 * Feature flags and provider configuration for the connector platform.
 *
 * Read from process.env on every call (not captured at import time) so tests
 * can flip flags per case and so a missing value can never be cached into a
 * wrong "enabled" state. Everything here fails CLOSED: an unset flag or a
 * missing secret disables the capability rather than defaulting it on.
 */

function flag(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function int(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const ConnectorConfig = {
  /** Master switch for the whole connector platform (routes still answer, tools never bind). */
  enabled: () => flag('CONNECTORS_ENABLED'),
  /** Tier 2/3 write tools. Off by default even when connectors are on - reads ship first. */
  writesEnabled: () => flag('CONNECTOR_WRITES_ENABLED'),
  /** Remote MCP endpoint for ChatGPT / other MCP clients. */
  mcpServerEnabled: () => flag('MCP_SERVER_ENABLED'),

  /**
   * Public origin of this deployment (e.g. https://nexus.example.com). Used to
   * build OAuth redirect URIs and MCP metadata URLs - never derived from the
   * request's Host header, which a client controls.
   */
  publicBaseUrl: () => (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, ''),
  /** Where the browser lands after an OAuth callback (the SPA). Defaults to publicBaseUrl. */
  appBaseUrl: () =>
    (process.env.CONNECTOR_APP_REDIRECT_URL || process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, ''),
  /**
   * Binds an OAuth flow to the browser that started it via an HttpOnly
   * cookie, on top of the user-bound single-use state. Only disable for a
   * split-origin setup where the cookie can't be set on the API origin.
   */
  oauthBrowserBinding: () => flag('CONNECTOR_OAUTH_BROWSER_BINDING', true),

  oauthStateTtlMs: () => int('CONNECTOR_OAUTH_STATE_TTL_SECONDS', 600) * 1000,
  approvalTtlMs: () => int('CONNECTOR_APPROVAL_TTL_SECONDS', 600) * 1000,
  /** Per-user, per-provider tool-call quota over `rateLimitWindowMs`. */
  providerCallLimit: () => int('CONNECTOR_PROVIDER_CALL_LIMIT', 200),
  rateLimitWindowMs: () => int('CONNECTOR_RATE_LIMIT_WINDOW_MINUTES', 60) * 60 * 1000,
  /** Serialized result budget handed to the model/UI per tool call. */
  maxResultChars: () => int('CONNECTOR_MAX_RESULT_CHARS', 24_000),

  github: {
    clientId: () => (process.env.GITHUB_CONNECTOR_CLIENT_ID || '').trim(),
    clientSecret: () => (process.env.GITHUB_CONNECTOR_CLIENT_SECRET || '').trim(),
    /**
     * 'app' (recommended): a GitHub App - permissions come from the App's
     * own configuration and the repositories the user installs it on, so no
     * scopes are requested. 'oauth': a classic OAuth App, scopes below.
     */
    mode: () => ((process.env.GITHUB_CONNECTOR_MODE || 'app').trim() === 'oauth' ? 'oauth' : 'app') as 'app' | 'oauth',
    readScopes: () => (process.env.GITHUB_CONNECTOR_READ_SCOPES || 'read:user repo').trim(),
    writeScopes: () => (process.env.GITHUB_CONNECTOR_WRITE_SCOPES || 'read:user repo').trim(),
  },

  gmail: {
    clientId: () => (process.env.GMAIL_CONNECTOR_CLIENT_ID || '').trim(),
    clientSecret: () => (process.env.GMAIL_CONNECTOR_CLIENT_SECRET || '').trim(),
  },

  marketData: {
    /** 'yahoo' is unofficial/unlicensed - see the provider's own warning. 'none' disables it. */
    provider: () => (process.env.MARKET_DATA_PROVIDER || 'yahoo').trim().toLowerCase(),
    /** Set only once a licensed source backs market-data.source.ts; gates exposure over MCP. */
    licensed: () => flag('MARKET_DATA_LICENSED'),
  },

  paperBroker: {
    startingCash: () => int('PAPER_BROKER_STARTING_CASH', 1_000_000),
    baseCurrency: () => (process.env.PAPER_BROKER_BASE_CURRENCY || 'INR').trim().toUpperCase(),
    maxOrderQuantity: () => int('PAPER_BROKER_MAX_ORDER_QTY', 10_000),
    maxOrderNotional: () => int('PAPER_BROKER_MAX_ORDER_NOTIONAL', 500_000),
  },
};
