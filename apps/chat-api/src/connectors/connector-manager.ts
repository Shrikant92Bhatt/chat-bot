import crypto from 'crypto';
import { ConnectionSummary, ConnectorCapability, ConnectorProviderId } from '@chat-monorepo/shared';
import { ConnectionRecord, ConnectorAdapter, ProviderHttpError } from './connector.types';
import { ConnectorConfig } from './connector-config';
import { COLLECTIONS, ConnectorStore } from './connector-store';
import { CredentialVault, ProviderCredentials } from './credential-vault';
import { ConnectorRegistry } from './connector-registry';
import { providerFetch } from './providers/http';
import { safeErrorMessage, sha256 } from './redact';

/**
 * Connection lifecycle (plan §6): begin OAuth → callback → encrypted
 * credentials → use (with refresh) → disconnect (revoke + delete).
 *
 * Linking a provider is entirely separate from signing in to NexusAI: the
 * user is already authenticated by the app session token when they start a
 * link, and the provider grant only ever lands on that user's connection.
 */

interface OAuthStateRecord extends Record<string, unknown> {
  ownerUid: string;
  providerId: ConnectorProviderId;
  capabilities: ConnectorCapability[];
  requestedScopes: string[];
  codeVerifier?: string;
  /** sha256 of the HttpOnly browser-binding cookie value. */
  bindingHash?: string;
  redirectUri: string;
  expiresAt: number;
}

export class ConnectorError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export type BeginConnectResult =
  | { kind: 'redirect'; authorizeUrl: string; bindingNonce: string }
  | { kind: 'connected'; connection: ConnectionSummary };

const ALL_CAPABILITIES: ConnectorCapability[] = ['read', 'write'];
const base64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function oauthRedirectUri(): string {
  return `${ConnectorConfig.publicBaseUrl()}/api/v1/connectors/oauth/callback`;
}

export class ConnectorManager {
  /** Single-flight token refresh per connection within this instance. */
  private readonly refreshing = new Map<string, Promise<ProviderCredentials | null>>();

  constructor(
    private readonly store: ConnectorStore,
    private readonly vault: CredentialVault,
    private readonly registry: ConnectorRegistry
  ) {}

  // ---------- queries ----------

  async listConnections(uid: string): Promise<ConnectionSummary[]> {
    const rows = await this.store.findBy<ConnectionRecord>(COLLECTIONS.connections, 'ownerUid', uid);
    return rows.map((r) => toSummary(r.data)).sort((a, b) => a.providerId.localeCompare(b.providerId));
  }

  /** The caller's connection for a provider, or null. Ownership is part of the lookup itself. */
  async getConnectionForProvider(uid: string, providerId: ConnectorProviderId): Promise<ConnectionRecord | null> {
    const rows = await this.store.findBy<ConnectionRecord>(COLLECTIONS.connections, 'ownerUid', uid);
    return rows.map((r) => r.data).find((c) => c.providerId === providerId) ?? null;
  }

  /** A connection by id - another user's id is indistinguishable from a missing one. */
  async getOwnedConnection(uid: string, connectionId: string): Promise<ConnectionRecord | null> {
    const record = await this.store.get<ConnectionRecord>(COLLECTIONS.connections, connectionId);
    return record && record.ownerUid === uid ? record : null;
  }

  // ---------- connect ----------

  private requireAdapter(providerId: string): ConnectorAdapter {
    const adapter = this.registry.getAdapter(providerId);
    if (!adapter) throw new ConnectorError(404, 'NotFound', 'Unknown connector.');
    const reason = this.registry.unavailableReason(adapter);
    if (reason) throw new ConnectorError(503, 'Unavailable', reason);
    return adapter;
  }

  async beginConnect(uid: string, providerId: string, requested?: ConnectorCapability[]): Promise<BeginConnectResult> {
    const adapter = this.requireAdapter(providerId);
    const capabilities = normalizeCapabilities(requested, adapter);

    if (!adapter.oauth) {
      const connection = await this.upsertConnection(uid, adapter, {
        grantedScopes: [],
        enabledCapabilities: capabilities,
        hasCredentials: false,
        accountLabel: undefined,
      });
      return { kind: 'connected', connection: toSummary(connection) };
    }

    const oauth = adapter.oauth;
    const state = base64url(crypto.randomBytes(32));
    const bindingNonce = base64url(crypto.randomBytes(32));
    const codeVerifier = oauth.usePkce ? base64url(crypto.randomBytes(48)) : undefined;
    const requestedScopes = oauth.scopesFor(capabilities);
    const redirectUri = oauthRedirectUri();

    const record: OAuthStateRecord = {
      ownerUid: uid,
      providerId: adapter.id,
      capabilities,
      requestedScopes,
      ...(codeVerifier ? { codeVerifier } : {}),
      ...(ConnectorConfig.oauthBrowserBinding() ? { bindingHash: sha256(bindingNonce) } : {}),
      redirectUri,
      expiresAt: Date.now() + ConnectorConfig.oauthStateTtlMs(),
    };
    // Stored under the hash, so a database read never reveals a usable state value.
    await this.store.set(COLLECTIONS.oauthStates, sha256(state), record);

    const url = new URL(oauth.authorizeUrl);
    url.searchParams.set('client_id', oauth.clientId());
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    if (requestedScopes.length) url.searchParams.set('scope', requestedScopes.join(' '));
    if (codeVerifier) {
      url.searchParams.set('code_challenge', base64url(crypto.createHash('sha256').update(codeVerifier).digest()));
      url.searchParams.set('code_challenge_method', 'S256');
    }
    for (const [k, v] of Object.entries(oauth.extraAuthorizeParams ?? {})) url.searchParams.set(k, v);

    return { kind: 'redirect', authorizeUrl: url.toString(), bindingNonce };
  }

  /**
   * Handles the provider redirect. `state` is consumed atomically before
   * anything else, so a replayed callback - even a concurrent one on another
   * instance - finds nothing. Returns the provider id for the post-callback
   * redirect; throws ConnectorError with a user-safe message otherwise.
   */
  async completeOAuth(params: {
    state?: string;
    code?: string;
    error?: string;
    bindingNonce?: string;
  }): Promise<{ providerId: ConnectorProviderId; ownerUid: string }> {
    if (!params.state) throw new ConnectorError(400, 'InvalidState', 'Missing OAuth state.');
    const stateId = sha256(params.state);
    const record = await this.store.transact<OAuthStateRecord, OAuthStateRecord | null>(COLLECTIONS.oauthStates, stateId, (current) => ({
      next: current ? null : undefined,
      result: current,
    }));
    if (!record || record.expiresAt < Date.now()) {
      throw new ConnectorError(400, 'InvalidState', 'This connection link is invalid or has expired. Please try again.');
    }
    if (record.bindingHash && (!params.bindingNonce || sha256(params.bindingNonce) !== record.bindingHash)) {
      throw new ConnectorError(400, 'InvalidState', 'This connection was started in a different browser session. Please try again.');
    }
    if (record.redirectUri !== oauthRedirectUri()) {
      throw new ConnectorError(400, 'InvalidState', 'Redirect URI mismatch.');
    }
    if (params.error) {
      throw new ConnectorError(400, 'ProviderDenied', 'Authorization was cancelled or denied at the provider.');
    }
    if (!params.code) throw new ConnectorError(400, 'InvalidState', 'Missing authorization code.');

    const adapter = this.requireAdapter(record.providerId);
    const oauth = adapter.oauth!;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const token = await providerFetch<{
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        token_type?: string;
        scope?: string;
        error?: string;
      }>({
        baseUrl: new URL(oauth.tokenUrl).origin,
        path: new URL(oauth.tokenUrl).pathname,
        method: 'POST',
        form: true,
        signal: controller.signal,
        body: {
          client_id: oauth.clientId(),
          client_secret: oauth.clientSecret(),
          code: params.code,
          redirect_uri: record.redirectUri,
          grant_type: 'authorization_code',
          ...(record.codeVerifier ? { code_verifier: record.codeVerifier } : {}),
        },
      });
      if (!token?.access_token) {
        // GitHub reports some token errors with a 200 and an `error` field.
        throw new ConnectorError(400, 'TokenExchangeFailed', 'The provider did not issue an access token.');
      }

      const grantedScopes = token.scope
        ? token.scope.split(/[\s,]+/).filter(Boolean)
        : oauth.grantedScopesFallback?.(record.requestedScopes) ?? record.requestedScopes;
      const credentials: ProviderCredentials = {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
        tokenType: token.token_type,
      };
      const accountLabel = await oauth.fetchAccountLabel(credentials.accessToken, controller.signal).catch(() => undefined);

      // Only keep capabilities whose scopes were actually granted (a user can untick scopes at consent).
      // The per-tool scope check in permission-policy.ts still applies on every call.
      const enabledCapabilities = record.capabilities.filter((cap) =>
        oauth.scopesFor([cap]).every((s) => grantedScopes.includes(s))
      );
      const existing = await this.getConnectionForProvider(record.ownerUid, adapter.id);
      const connection = await this.upsertConnection(record.ownerUid, adapter, {
        grantedScopes,
        enabledCapabilities: enabledCapabilities.length ? enabledCapabilities : ['read'],
        hasCredentials: true,
        accountLabel,
      }, existing);
      await this.vault.put(record.ownerUid, connection.id, credentials);
      return { providerId: adapter.id, ownerUid: record.ownerUid };
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      console.error(`[ConnectorManager] OAuth completion failed for ${record.providerId}:`, safeErrorMessage(error));
      throw new ConnectorError(502, 'TokenExchangeFailed', 'Could not complete the connection with the provider.');
    } finally {
      clearTimeout(timer);
    }
  }

  private async upsertConnection(
    uid: string,
    adapter: ConnectorAdapter,
    fields: Pick<ConnectionRecord, 'grantedScopes' | 'enabledCapabilities' | 'hasCredentials' | 'accountLabel'>,
    existing?: ConnectionRecord | null
  ): Promise<ConnectionRecord> {
    const prior = existing === undefined ? await this.getConnectionForProvider(uid, adapter.id) : existing;
    const now = Date.now();
    const record: ConnectionRecord = {
      id: prior?.id ?? crypto.randomUUID(),
      ownerUid: uid,
      providerId: adapter.id,
      status: 'active',
      grantedScopes: fields.grantedScopes,
      enabledCapabilities: fields.enabledCapabilities,
      hasCredentials: fields.hasCredentials,
      ...(fields.accountLabel ? { accountLabel: fields.accountLabel } : prior?.accountLabel ? { accountLabel: prior.accountLabel } : {}),
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
      lastCheckedAt: now,
    };
    await this.store.set(COLLECTIONS.connections, record.id, record);
    return record;
  }

  // ---------- capabilities / checks ----------

  /**
   * Turns capabilities on/off. Turning on one whose provider scopes were
   * never granted returns a re-authorization URL instead (incremental
   * consent) - scopes are only requested when the user enables the feature.
   */
  async setCapabilities(
    uid: string,
    connectionId: string,
    capabilities: ConnectorCapability[]
  ): Promise<{ connection: ConnectionSummary } | { reauthorize: BeginConnectResult }> {
    const connection = await this.getOwnedConnection(uid, connectionId);
    if (!connection) throw new ConnectorError(404, 'NotFound', 'Connection not found.');
    const adapter = this.requireAdapter(connection.providerId);
    const wanted = normalizeCapabilities(capabilities, adapter, false);

    if (adapter.oauth) {
      const needed = adapter.oauth.scopesFor(wanted);
      if (needed.some((s) => !connection.grantedScopes.includes(s))) {
        return { reauthorize: await this.beginConnect(uid, adapter.id, wanted) };
      }
    }
    const updated: ConnectionRecord = { ...connection, enabledCapabilities: wanted, updatedAt: Date.now() };
    await this.store.set(COLLECTIONS.connections, connection.id, updated);
    return { connection: toSummary(updated) };
  }

  /** Verifies the stored grant still works (refreshing if needed) and updates status. */
  async checkConnection(uid: string, connectionId: string): Promise<ConnectionSummary> {
    const connection = await this.getOwnedConnection(uid, connectionId);
    if (!connection) throw new ConnectorError(404, 'NotFound', 'Connection not found.');
    const adapter = this.requireAdapter(connection.providerId);
    if (!adapter.oauth) {
      const updated = { ...connection, lastCheckedAt: Date.now() };
      await this.store.set(COLLECTIONS.connections, connection.id, updated);
      return toSummary(updated);
    }
    const credentials = await this.getCredentials(connection);
    let next: ConnectionRecord;
    if (!credentials) {
      next = { ...connection, status: 'expired', lastCheckedAt: Date.now(), lastError: 'Authorization expired or was revoked.' };
    } else {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const label = await adapter.oauth.fetchAccountLabel(credentials.accessToken, controller.signal);
        next = { ...connection, status: 'active', accountLabel: label, lastCheckedAt: Date.now() };
        delete next.lastError;
      } catch (error) {
        const authFailed = error instanceof ProviderHttpError && error.status === 401;
        next = {
          ...connection,
          status: authFailed ? 'expired' : 'error',
          lastCheckedAt: Date.now(),
          lastError: authFailed ? 'Authorization expired or was revoked.' : safeErrorMessage(error),
        };
      } finally {
        clearTimeout(timer);
      }
    }
    await this.store.set(COLLECTIONS.connections, connection.id, next);
    return toSummary(next);
  }

  async markStatus(connection: ConnectionRecord, status: ConnectionRecord['status'], lastError?: string): Promise<void> {
    const current = await this.store.get<ConnectionRecord>(COLLECTIONS.connections, connection.id);
    if (!current || current.ownerUid !== connection.ownerUid) return;
    await this.store.set(COLLECTIONS.connections, connection.id, {
      ...current,
      status,
      updatedAt: Date.now(),
      ...(lastError ? { lastError } : {}),
    });
  }

  /** Best-effort, throttled "last used" stamp. */
  async markUsed(connection: ConnectionRecord): Promise<void> {
    if (connection.lastUsedAt && Date.now() - connection.lastUsedAt < 60_000) return;
    try {
      const current = await this.store.get<ConnectionRecord>(COLLECTIONS.connections, connection.id);
      if (current && current.ownerUid === connection.ownerUid) {
        await this.store.set(COLLECTIONS.connections, connection.id, { ...current, lastUsedAt: Date.now() });
      }
    } catch {
      // Diagnostic only.
    }
  }

  // ---------- credentials ----------

  /**
   * Decrypted, unexpired credentials for an owned connection, refreshing
   * server-side when close to expiry. Returns null (and marks the connection
   * expired) when the grant can no longer be used - callers fail closed.
   */
  async getCredentials(connection: ConnectionRecord): Promise<ProviderCredentials | null> {
    const credentials = await this.vault.get(connection.ownerUid, connection.id);
    if (!credentials) return null;
    if (!credentials.expiresAt || credentials.expiresAt - 60_000 > Date.now()) return credentials;
    if (!credentials.refreshToken) {
      await this.markStatus(connection, 'expired', 'Authorization expired.');
      return null;
    }
    const inFlight = this.refreshing.get(connection.id);
    if (inFlight) return inFlight;
    const task = this.refresh(connection, credentials).finally(() => this.refreshing.delete(connection.id));
    this.refreshing.set(connection.id, task);
    return task;
  }

  private async refresh(connection: ConnectionRecord, credentials: ProviderCredentials): Promise<ProviderCredentials | null> {
    const adapter = this.registry.getAdapter(connection.providerId);
    if (!adapter?.oauth) return null;
    const oauth = adapter.oauth;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const token = await providerFetch<{ access_token?: string; refresh_token?: string; expires_in?: number; token_type?: string }>({
        baseUrl: new URL(oauth.tokenUrl).origin,
        path: new URL(oauth.tokenUrl).pathname,
        method: 'POST',
        form: true,
        signal: controller.signal,
        body: {
          client_id: oauth.clientId(),
          client_secret: oauth.clientSecret(),
          grant_type: 'refresh_token',
          refresh_token: credentials.refreshToken!,
        },
      });
      if (!token?.access_token) throw new ProviderHttpError('Refresh returned no token.', 400, false);
      const next: ProviderCredentials = {
        accessToken: token.access_token,
        // Providers that rotate refresh tokens (GitHub Apps) return a new one; Google keeps the old.
        refreshToken: token.refresh_token ?? credentials.refreshToken,
        expiresAt: token.expires_in ? Date.now() + token.expires_in * 1000 : undefined,
        tokenType: token.token_type ?? credentials.tokenType,
      };
      await this.vault.put(connection.ownerUid, connection.id, next);
      return next;
    } catch (error) {
      const permanent = error instanceof ProviderHttpError && error.status >= 400 && error.status < 500;
      console.error(`[ConnectorManager] Token refresh failed for connection ${connection.id}:`, safeErrorMessage(error));
      if (permanent) await this.markStatus(connection, 'expired', 'Authorization expired or was revoked.');
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // ---------- disconnect ----------

  /**
   * Revokes at the provider where supported (best-effort - local deletion
   * proceeds even if the provider is unreachable), then deletes credentials,
   * the connection and connection-scoped data. Returns false when not found.
   */
  async disconnect(uid: string, connectionId: string): Promise<boolean> {
    const connection = await this.getOwnedConnection(uid, connectionId);
    if (!connection) return false;
    const adapter = this.registry.getAdapter(connection.providerId);

    if (adapter?.oauth?.revoke) {
      const credentials = await this.vault.get(uid, connectionId);
      if (credentials) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        await adapter.oauth
          .revoke(credentials, controller.signal)
          .catch((error) => console.warn(`[ConnectorManager] Provider revoke failed for ${connection.providerId}:`, safeErrorMessage(error)))
          .finally(() => clearTimeout(timer));
      }
    }

    await this.vault.delete(connectionId);
    await this.store.delete(COLLECTIONS.connections, connectionId);
    // Connection-scoped data goes with the connection.
    await this.store.delete(COLLECTIONS.paperPortfolios, connectionId).catch(() => undefined);
    const drafts = await this.store.findBy<{ connectionId: string }>(COLLECTIONS.socialDrafts, 'ownerUid', uid).catch(() => []);
    await Promise.allSettled(drafts.filter((d) => d.data.connectionId === connectionId).map((d) => this.store.delete(COLLECTIONS.socialDrafts, d.id)));
    return true;
  }
}

function normalizeCapabilities(
  requested: ConnectorCapability[] | undefined,
  adapter: ConnectorAdapter,
  applyDefault = true
): ConnectorCapability[] {
  const offered = new Set(adapter.tools.map((t) => t.capability));
  const base = requested && requested.length ? requested : applyDefault ? adapter.defaultCapabilities : [];
  const caps = ALL_CAPABILITIES.filter((c) => base.includes(c) && offered.has(c));
  // Read is the floor - a connection with nothing enabled is pointless.
  return caps.includes('read') || !offered.has('read') ? caps : ['read', ...caps];
}

export function toSummary(c: ConnectionRecord): ConnectionSummary {
  return {
    id: c.id,
    providerId: c.providerId,
    status: c.status,
    accountLabel: c.accountLabel,
    grantedScopes: c.grantedScopes,
    enabledCapabilities: c.enabledCapabilities,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    lastUsedAt: c.lastUsedAt,
    lastCheckedAt: c.lastCheckedAt,
    lastError: c.lastError,
  };
}
