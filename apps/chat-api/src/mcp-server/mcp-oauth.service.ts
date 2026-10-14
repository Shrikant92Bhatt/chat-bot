import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { COLLECTIONS, ConnectorStore } from '../connectors/connector-store';
import { ConnectorConfig } from '../connectors/connector-config';
import { sha256 } from '../connectors/redact';

/**
 * OAuth 2.1 authorization server for the remote MCP endpoint (plan §9).
 *
 * ChatGPT (or any MCP client) is a separate client with its own identity:
 * it never sees a NexusAI browser session token, and NexusAI never accepts an
 * MCP token as a session. That separation is cryptographic - MCP access
 * tokens are signed with MCP_OAUTH_SIGNING_SECRET, which must differ from
 * APP_SESSION_SECRET, and carry an audience equal to this MCP resource.
 *
 * Implements what the MCP authorization spec asks of a server: protected
 * resource metadata (RFC 9728), authorization server metadata (RFC 8414),
 * dynamic client registration (RFC 7591, public clients), authorization code
 * + PKCE S256 only, resource indicators (RFC 8707) and refresh-token
 * rotation. Each user consent creates a revocable grant; access tokens are
 * checked against it on every request, so revoking in Settings is immediate.
 */

export const MCP_SCOPES = ['nexus.read'] as const;
const ACCESS_TOKEN_TTL_S = 60 * 60;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 5 * 60 * 1000;
const CONSENT_REQUEST_TTL_S = 10 * 60;

export interface McpClientRecord extends Record<string, unknown> {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  createdAt: number;
}

export interface McpGrantRecord extends Record<string, unknown> {
  id: string;
  ownerUid: string;
  clientId: string;
  clientName: string;
  scope: string;
  createdAt: number;
  lastUsedAt?: number;
}

interface CodeRecord extends Record<string, unknown> {
  grantId: string;
  ownerUid: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource: string;
  expiresAt: number;
}

interface RefreshRecord extends Record<string, unknown> {
  grantId: string;
  ownerUid: string;
  clientId: string;
  scope: string;
  resource: string;
  expiresAt: number;
}

export interface ConsentRequest {
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  state?: string;
  resource: string;
}

export interface McpAccessClaims {
  sub: string;
  client_id: string;
  scope: string;
  grant_id: string;
}

export class OAuthError extends Error {
  constructor(
    readonly status: number,
    readonly error: string,
    readonly description: string
  ) {
    super(description);
  }
}

const GRANTS = 'mcpOAuthGrants';
const random = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export function mcpIssuer(): string {
  return ConnectorConfig.publicBaseUrl();
}

export function mcpResource(): string {
  return `${ConnectorConfig.publicBaseUrl()}/api/mcp`;
}

/** Fails closed unless a dedicated secret, distinct from the app session secret, is configured. */
export function mcpSigningSecret(): string | null {
  const secret = process.env.MCP_OAUTH_SIGNING_SECRET?.trim();
  if (!secret || secret.length < 32) return null;
  if (secret === process.env.APP_SESSION_SECRET?.trim()) return null;
  return secret;
}

export function mcpUnavailableReason(): string | null {
  if (!ConnectorConfig.mcpServerEnabled()) return 'The MCP server is disabled.';
  if (!ConnectorConfig.enabled()) return 'Connectors are disabled.';
  if (!ConnectorConfig.publicBaseUrl()) return 'PUBLIC_BASE_URL is not configured.';
  if (!mcpSigningSecret()) return 'MCP_OAUTH_SIGNING_SECRET is missing, too short, or equal to APP_SESSION_SECRET.';
  return null;
}

function allowedRedirectHosts(): string[] {
  return (process.env.MCP_OAUTH_ALLOWED_REDIRECT_HOSTS ?? 'chatgpt.com,chat.openai.com')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/** https only (http allowed for loopback dev clients), no fragments, host on the allowlist when one is set. */
export function isAcceptableRedirectUri(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.hash) return false;
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return false;
  const hosts = allowedRedirectHosts();
  if (hosts.includes('*') || loopback) return true;
  return hosts.some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`));
}

function normalizeScope(raw: string | undefined): string {
  const requested = (raw ?? '').split(/\s+/).filter(Boolean);
  const granted = requested.filter((s) => (MCP_SCOPES as readonly string[]).includes(s));
  return (granted.length ? granted : [...MCP_SCOPES]).join(' ');
}

function s256(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export class McpOAuthService {
  constructor(private readonly store: ConnectorStore) {}

  // ---------- metadata ----------

  protectedResourceMetadata() {
    return {
      resource: mcpResource(),
      authorization_servers: [mcpIssuer()],
      scopes_supported: [...MCP_SCOPES],
      bearer_methods_supported: ['header'],
      resource_name: 'NexusAI',
    };
  }

  authorizationServerMetadata() {
    const base = mcpIssuer();
    return {
      issuer: base,
      authorization_endpoint: `${base}/api/oauth/authorize`,
      token_endpoint: `${base}/api/oauth/token`,
      registration_endpoint: `${base}/api/oauth/register`,
      revocation_endpoint: `${base}/api/oauth/revoke`,
      scopes_supported: [...MCP_SCOPES],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
    };
  }

  // ---------- dynamic client registration ----------

  async registerClient(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const redirectUris = body.redirect_uris;
    if (!Array.isArray(redirectUris) || redirectUris.length === 0 || redirectUris.length > 5) {
      throw new OAuthError(400, 'invalid_redirect_uri', 'redirect_uris must list 1-5 URIs.');
    }
    if (!redirectUris.every((u) => typeof u === 'string' && u.length <= 500 && isAcceptableRedirectUri(u))) {
      throw new OAuthError(400, 'invalid_redirect_uri', 'A redirect URI is not allowed by this server.');
    }
    const authMethod = body.token_endpoint_auth_method ?? 'none';
    if (authMethod !== 'none') {
      throw new OAuthError(400, 'invalid_client_metadata', 'Only public clients (token_endpoint_auth_method "none") are supported.');
    }
    const clientName = typeof body.client_name === 'string' && body.client_name.trim() ? body.client_name.trim().slice(0, 100) : 'MCP client';
    const record: McpClientRecord = { clientId: `mcp_${random(18)}`, clientName, redirectUris: redirectUris as string[], createdAt: Date.now() };
    await this.store.set(COLLECTIONS.mcpClients, record.clientId, record);
    return {
      client_id: record.clientId,
      client_id_issued_at: Math.floor(record.createdAt / 1000),
      client_name: clientName,
      redirect_uris: record.redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  // ---------- authorize → consent ----------

  /**
   * Validates an authorization request. On success returns a short-lived
   * signed consent request for the SPA's consent screen. Errors that make the
   * redirect URI untrustworthy are thrown (shown to the user, not redirected).
   */
  async validateAuthorizeRequest(q: Record<string, string | undefined>): Promise<string> {
    const secret = mcpSigningSecret();
    if (!secret) throw new OAuthError(503, 'temporarily_unavailable', 'The MCP server is not configured.');
    const client = q.client_id ? await this.store.get<McpClientRecord>(COLLECTIONS.mcpClients, q.client_id) : null;
    if (!client) throw new OAuthError(400, 'invalid_client', 'Unknown client.');
    if (!q.redirect_uri || !client.redirectUris.includes(q.redirect_uri)) {
      throw new OAuthError(400, 'invalid_request', 'redirect_uri does not match a registered URI.');
    }
    if (q.response_type !== 'code') throw new OAuthError(400, 'unsupported_response_type', 'Only response_type=code is supported.');
    if (!q.code_challenge || q.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(q.code_challenge)) {
      throw new OAuthError(400, 'invalid_request', 'PKCE with code_challenge_method=S256 is required.');
    }
    if (q.resource && q.resource.replace(/\/+$/, '') !== mcpResource()) {
      throw new OAuthError(400, 'invalid_target', 'Unknown resource.');
    }
    const request: ConsentRequest = {
      clientId: client.clientId,
      clientName: client.clientName,
      redirectUri: q.redirect_uri,
      codeChallenge: q.code_challenge,
      scope: normalizeScope(q.scope),
      ...(q.state ? { state: q.state.slice(0, 500) } : {}),
      resource: mcpResource(),
    };
    return jwt.sign({ typ: 'mcp_consent', req: request }, secret, { expiresIn: CONSENT_REQUEST_TTL_S, audience: 'mcp-consent' });
  }

  readConsentRequest(token: string): ConsentRequest {
    const secret = mcpSigningSecret();
    if (!secret) throw new OAuthError(503, 'temporarily_unavailable', 'The MCP server is not configured.');
    try {
      const payload = jwt.verify(token, secret, { audience: 'mcp-consent', algorithms: ['HS256'] }) as { typ?: string; req?: ConsentRequest };
      if (payload.typ !== 'mcp_consent' || !payload.req) throw new Error('bad type');
      return payload.req;
    } catch {
      throw new OAuthError(400, 'invalid_request', 'This authorization request is invalid or expired. Start again from the client.');
    }
  }

  /**
   * The signed-in user's decision (from the SPA, with their app session).
   * Returns the URL to send the browser back to the client.
   */
  async decide(uid: string, consentToken: string, approve: boolean): Promise<string> {
    const req = this.readConsentRequest(consentToken);
    const url = new URL(req.redirectUri);
    if (req.state) url.searchParams.set('state', req.state);
    url.searchParams.set('iss', mcpIssuer());
    if (!approve) {
      url.searchParams.set('error', 'access_denied');
      return url.toString();
    }
    const grant: McpGrantRecord = {
      id: crypto.randomUUID(),
      ownerUid: uid,
      clientId: req.clientId,
      clientName: req.clientName,
      scope: req.scope,
      createdAt: Date.now(),
    };
    await this.store.set(GRANTS, grant.id, grant);
    const code = random(32);
    const record: CodeRecord = {
      grantId: grant.id,
      ownerUid: uid,
      clientId: req.clientId,
      redirectUri: req.redirectUri,
      codeChallenge: req.codeChallenge,
      scope: req.scope,
      resource: req.resource,
      expiresAt: Date.now() + CODE_TTL_MS,
    };
    await this.store.set(COLLECTIONS.mcpCodes, sha256(code), record);
    url.searchParams.set('code', code);
    return url.toString();
  }

  // ---------- token endpoint ----------

  async token(body: Record<string, string | undefined>): Promise<Record<string, unknown>> {
    const secret = mcpSigningSecret();
    if (!secret) throw new OAuthError(503, 'temporarily_unavailable', 'The MCP server is not configured.');

    if (body.grant_type === 'authorization_code') {
      if (!body.code || !body.code_verifier || !body.client_id || !body.redirect_uri) {
        throw new OAuthError(400, 'invalid_request', 'code, code_verifier, client_id and redirect_uri are required.');
      }
      // Single use: consumed atomically whether or not the rest checks out.
      const record = await this.store.transact<CodeRecord, CodeRecord | null>(COLLECTIONS.mcpCodes, sha256(body.code), (current) => ({
        next: current ? null : undefined,
        result: current,
      }));
      if (
        !record ||
        record.expiresAt < Date.now() ||
        record.clientId !== body.client_id ||
        record.redirectUri !== body.redirect_uri ||
        s256(body.code_verifier) !== record.codeChallenge ||
        (body.resource && body.resource.replace(/\/+$/, '') !== record.resource)
      ) {
        throw new OAuthError(400, 'invalid_grant', 'The authorization code is invalid, expired or does not match.');
      }
      if (!(await this.store.get<McpGrantRecord>(GRANTS, record.grantId))) {
        throw new OAuthError(400, 'invalid_grant', 'The grant was revoked.');
      }
      return this.issue(secret, record);
    }

    if (body.grant_type === 'refresh_token') {
      if (!body.refresh_token || !body.client_id) throw new OAuthError(400, 'invalid_request', 'refresh_token and client_id are required.');
      // Rotation: the presented refresh token is consumed; a replay finds nothing.
      const record = await this.store.transact<RefreshRecord, RefreshRecord | null>(
        COLLECTIONS.mcpRefreshTokens,
        sha256(body.refresh_token),
        (current) => ({ next: current ? null : undefined, result: current })
      );
      if (!record || record.expiresAt < Date.now() || record.clientId !== body.client_id) {
        throw new OAuthError(400, 'invalid_grant', 'The refresh token is invalid or expired.');
      }
      if (!(await this.store.get<McpGrantRecord>(GRANTS, record.grantId))) {
        throw new OAuthError(400, 'invalid_grant', 'The grant was revoked.');
      }
      return this.issue(secret, record);
    }

    throw new OAuthError(400, 'unsupported_grant_type', 'Only authorization_code and refresh_token are supported.');
  }

  private async issue(secret: string, r: { grantId: string; ownerUid: string; clientId: string; scope: string; resource: string }) {
    const claims: McpAccessClaims = { sub: r.ownerUid, client_id: r.clientId, scope: r.scope, grant_id: r.grantId };
    const accessToken = jwt.sign(claims, secret, {
      expiresIn: ACCESS_TOKEN_TTL_S,
      issuer: mcpIssuer(),
      audience: r.resource,
      jwtid: crypto.randomUUID(),
      header: { alg: 'HS256', typ: 'at+jwt' },
    });
    const refreshToken = random(32);
    const refresh: RefreshRecord = { ...r, expiresAt: Date.now() + REFRESH_TOKEN_TTL_MS };
    await this.store.set(COLLECTIONS.mcpRefreshTokens, sha256(refreshToken), refresh);
    return { access_token: accessToken, token_type: 'Bearer', expires_in: ACCESS_TOKEN_TTL_S, refresh_token: refreshToken, scope: r.scope };
  }

  async revokeToken(token: string | undefined): Promise<void> {
    if (token) await this.store.delete(COLLECTIONS.mcpRefreshTokens, sha256(token));
  }

  // ---------- resource-server side ----------

  /** Verifies an MCP bearer token: signature, issuer, audience, expiry, scope, and that its grant still exists. */
  async verifyAccessToken(token: string): Promise<McpAccessClaims | null> {
    const secret = mcpSigningSecret();
    if (!secret) return null;
    let claims: McpAccessClaims & jwt.JwtPayload;
    try {
      claims = jwt.verify(token, secret, { issuer: mcpIssuer(), audience: mcpResource(), algorithms: ['HS256'] }) as McpAccessClaims &
        jwt.JwtPayload;
    } catch {
      return null;
    }
    if (!claims.sub || !claims.grant_id || !claims.scope?.split(' ').includes('nexus.read')) return null;
    const grant = await this.store.get<McpGrantRecord>(GRANTS, claims.grant_id);
    if (!grant || grant.ownerUid !== claims.sub || grant.clientId !== claims.client_id) return null;
    if (!grant.lastUsedAt || Date.now() - grant.lastUsedAt > 5 * 60_000) {
      void this.store.set(GRANTS, grant.id, { ...grant, lastUsedAt: Date.now() }).catch(() => undefined);
    }
    return { sub: claims.sub, client_id: claims.client_id, scope: claims.scope, grant_id: claims.grant_id };
  }

  // ---------- user-facing grant management ----------

  async listGrants(uid: string): Promise<Array<Omit<McpGrantRecord, 'ownerUid'>>> {
    const rows = await this.store.findBy<McpGrantRecord>(GRANTS, 'ownerUid', uid);
    return rows
      .map(({ data: { ownerUid: _owner, ...rest } }) => rest)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Revokes a grant: its access tokens stop verifying immediately and its refresh tokens are deleted. */
  async revokeGrant(uid: string, grantId: string): Promise<boolean> {
    const grant = await this.store.get<McpGrantRecord>(GRANTS, grantId);
    if (!grant || grant.ownerUid !== uid) return false;
    await this.store.delete(GRANTS, grantId);
    const refresh = await this.store.findBy<RefreshRecord>(COLLECTIONS.mcpRefreshTokens, 'grantId', grantId);
    await Promise.allSettled(refresh.map((r) => this.store.delete(COLLECTIONS.mcpRefreshTokens, r.id)));
    return true;
  }
}
