import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COLLECTIONS, MemoryConnectorStore } from './connector-store';
import { CredentialVault, EnvKeyProvider } from './credential-vault';
import { createTestPlatform, FakeCalls, newCalls, setConnectorTestEnv, TEST_KEY } from './testing/fake-connector';

const ALICE = 'uid-alice';

interface TokenReply {
  status?: number;
  body: Record<string, unknown>;
}

/** Stubs fetch for the fake provider's token endpoint and records requests. */
function stubTokenEndpoint(replies: TokenReply[]) {
  const requests: URLSearchParams[] = [];
  const fetchMock = vi.fn(async (url: URL | string, init?: RequestInit) => {
    const href = String(url);
    if (!href.startsWith('https://auth.fake.test/token')) throw new Error(`unexpected fetch ${href}`);
    requests.push(new URLSearchParams(String(init?.body ?? '')));
    const reply = replies.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return requests;
}

describe('OAuth connection lifecycle', () => {
  let calls: FakeCalls;
  let ctx: ReturnType<typeof createTestPlatform>;

  beforeEach(() => {
    setConnectorTestEnv();
    calls = newCalls();
    ctx = createTestPlatform(calls);
  });
  afterEach(() => vi.unstubAllGlobals());

  async function begin(capabilities: Array<'read' | 'write'> = ['read']) {
    const result = await ctx.platform.manager.beginConnect(ALICE, 'github', capabilities);
    if (result.kind !== 'redirect') throw new Error('expected redirect');
    const url = new URL(result.authorizeUrl);
    return { url, state: url.searchParams.get('state')!, nonce: result.bindingNonce };
  }

  it('builds a least-privilege PKCE authorize URL and stores only a hash of the state', async () => {
    const { url, state } = await begin(['read']);
    expect(url.origin + url.pathname).toBe('https://auth.fake.test/authorize');
    expect(url.searchParams.get('scope')).toBe('fake.read'); // write scope NOT requested up front
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe('https://nexus.test/api/v1/connectors/oauth/callback');
    const stored = JSON.stringify(ctx.store.dump(COLLECTIONS.oauthStates));
    expect(stored).not.toContain(state);
  });

  it('completes, encrypts credentials at rest and never exposes tokens in metadata', async () => {
    const { state, nonce } = await begin(['read']);
    const requests = stubTokenEndpoint([{ body: { access_token: 'tok-ACCESS-123', refresh_token: 'tok-REFRESH-456', expires_in: 3600, scope: 'fake.read' } }]);
    await ctx.platform.manager.completeOAuth({ state, code: 'auth-code', bindingNonce: nonce });

    expect(requests[0].get('grant_type')).toBe('authorization_code');
    expect(requests[0].get('code_verifier')).toBeTruthy();
    const [conn] = await ctx.platform.manager.listConnections(ALICE);
    expect(conn).toMatchObject({ providerId: 'github', status: 'active', accountLabel: 'fake-user', grantedScopes: ['fake.read'], enabledCapabilities: ['read'] });
    expect(JSON.stringify(conn)).not.toContain('tok-');

    const rawStore = JSON.stringify([...ctx.store.dump(COLLECTIONS.credentials), ...ctx.store.dump(COLLECTIONS.connections)]);
    expect(rawStore).not.toContain('tok-ACCESS-123');
    expect(rawStore).not.toContain('tok-REFRESH-456');

    const read = await ctx.platform.executor.execute({ uid: ALICE, client: 'nexus' }, 'fakeoauth_read', { query: 'q' });
    expect(read.ok).toBe(true);
    expect(calls.lastAccessToken).toBe('tok-ACCESS-123');
  });

  it('rejects a replayed, expired, unknown or wrong-browser callback', async () => {
    const { state, nonce } = await begin();
    await expect(ctx.platform.manager.completeOAuth({ state, code: 'c', bindingNonce: 'other-browser' })).rejects.toMatchObject({ code: 'InvalidState' });
    // The state was consumed by that attempt - the legitimate browser can't reuse it either.
    await expect(ctx.platform.manager.completeOAuth({ state, code: 'c', bindingNonce: nonce })).rejects.toMatchObject({ code: 'InvalidState' });
    await expect(ctx.platform.manager.completeOAuth({ state: 'made-up', code: 'c' })).rejects.toMatchObject({ code: 'InvalidState' });

    process.env.CONNECTOR_OAUTH_STATE_TTL_SECONDS = '1';
    const late = await begin();
    vi.useFakeTimers({ now: Date.now() + 5_000 });
    await expect(ctx.platform.manager.completeOAuth({ state: late.state, code: 'c', bindingNonce: late.nonce })).rejects.toMatchObject({
      code: 'InvalidState',
    });
    vi.useRealTimers();
    delete process.env.CONNECTOR_OAUTH_STATE_TTL_SECONDS;
    expect(await ctx.platform.manager.listConnections(ALICE)).toEqual([]);
  });

  it('only enables capabilities whose scopes were actually granted', async () => {
    const { state, nonce } = await begin(['read', 'write']);
    stubTokenEndpoint([{ body: { access_token: 'a', scope: 'fake.read' } }]); // user unticked write at consent
    await ctx.platform.manager.completeOAuth({ state, code: 'c', bindingNonce: nonce });
    const [conn] = await ctx.platform.manager.listConnections(ALICE);
    expect(conn.enabledCapabilities).toEqual(['read']);
  });

  it('asks for re-authorization (incremental consent) when enabling a capability with missing scopes', async () => {
    const { state, nonce } = await begin(['read']);
    stubTokenEndpoint([{ body: { access_token: 'a', scope: 'fake.read' } }]);
    await ctx.platform.manager.completeOAuth({ state, code: 'c', bindingNonce: nonce });
    const [conn] = await ctx.platform.manager.listConnections(ALICE);
    const result = await ctx.platform.manager.setCapabilities(ALICE, conn.id, ['read', 'write']);
    expect('reauthorize' in result).toBe(true);
    if ('reauthorize' in result && result.reauthorize.kind === 'redirect') {
      expect(new URL(result.reauthorize.authorizeUrl).searchParams.get('scope')).toBe('fake.read fake.write');
    }
  });

  it('refreshes an expiring token server-side, and fails closed when refresh is rejected', async () => {
    const { state, nonce } = await begin();
    stubTokenEndpoint([
      { body: { access_token: 'old', refresh_token: 'r1', expires_in: 1, scope: 'fake.read' } },
      { body: { access_token: 'new', refresh_token: 'r2', expires_in: 3600 } },
    ]);
    await ctx.platform.manager.completeOAuth({ state, code: 'c', bindingNonce: nonce });
    expect((await ctx.platform.executor.execute({ uid: ALICE, client: 'nexus' }, 'fakeoauth_read', { query: 'q' })).ok).toBe(true);
    expect(calls.lastAccessToken).toBe('new');

    // Force expiry again; this time the provider rejects the refresh token.
    const [conn] = await ctx.platform.manager.listConnections(ALICE);
    await ctx.platform.vault.put(ALICE, conn.id, { accessToken: 'new', refreshToken: 'r2', expiresAt: Date.now() - 1 });
    stubTokenEndpoint([{ status: 400, body: { error: 'invalid_grant' } }]);
    const denied = await ctx.platform.executor.execute({ uid: ALICE, client: 'nexus' }, 'fakeoauth_read', { query: 'q' });
    expect(denied.error?.code).toBe('PROVIDER_AUTH_FAILED');
    expect((await ctx.platform.manager.listConnections(ALICE))[0].status).toBe('expired');
  });

  it('marks the connection expired when the provider rejects the token (revoked upstream)', async () => {
    const { state, nonce } = await begin();
    stubTokenEndpoint([{ body: { access_token: 'a', scope: 'fake.read' } }]);
    await ctx.platform.manager.completeOAuth({ state, code: 'c', bindingNonce: nonce });
    calls.readBehaviour = 'unauthorized';
    const result = await ctx.platform.executor.execute({ uid: ALICE, client: 'nexus' }, 'fakeoauth_read', { query: 'q' });
    expect(result.error?.code).toBe('PROVIDER_AUTH_FAILED');
    calls.readBehaviour = 'ok';
    const again = await ctx.platform.executor.execute({ uid: ALICE, client: 'nexus' }, 'fakeoauth_read', { query: 'q' });
    expect(again.error?.code).toBe('CONNECTION_INACTIVE');
  });

  it('disconnect revokes at the provider and deletes credentials and metadata', async () => {
    const { state, nonce } = await begin();
    stubTokenEndpoint([{ body: { access_token: 'a', scope: 'fake.read' } }]);
    await ctx.platform.manager.completeOAuth({ state, code: 'c', bindingNonce: nonce });
    const [conn] = await ctx.platform.manager.listConnections(ALICE);
    expect(await ctx.platform.disconnect(ALICE, conn.id)).toBe(true);
    expect(calls.writes).toContainEqual({ input: 'revoke' });
    expect(ctx.store.dump(COLLECTIONS.credentials)).toEqual([]);
    expect(ctx.store.dump(COLLECTIONS.connections)).toEqual([]);
  });

  it('refuses OAuth providers when credential encryption is not configured', async () => {
    delete process.env.CONNECTOR_ENCRYPTION_KEY;
    await expect(ctx.platform.manager.beginConnect(ALICE, 'github', ['read'])).rejects.toMatchObject({ status: 503 });
  });
});

describe('CredentialVault', () => {
  beforeEach(() => setConnectorTestEnv());

  it('round-trips and binds ciphertext to its owner and connection', async () => {
    const store = new MemoryConnectorStore();
    const vault = new CredentialVault(store);
    await vault.put('alice', 'c1', { accessToken: 'secret-token' });
    expect(await vault.get('alice', 'c1')).toEqual({ accessToken: 'secret-token' });
    expect(JSON.stringify(store.dump(COLLECTIONS.credentials))).not.toContain('secret-token');

    expect(await vault.get('bob', 'c1')).toBeNull();
    // Copying the envelope onto another connection id must not decrypt.
    const envelope = await store.get<Record<string, unknown>>(COLLECTIONS.credentials, 'c1');
    await store.set(COLLECTIONS.credentials, 'c2', { ...envelope!, connectionId: 'c2' });
    expect(await vault.get('alice', 'c2')).toBeNull();
  });

  it('decrypts envelopes sealed with the previous key after rotation', async () => {
    const store = new MemoryConnectorStore();
    const vault = new CredentialVault(store);
    await vault.put('alice', 'c1', { accessToken: 't' });
    process.env.CONNECTOR_ENCRYPTION_KEY_PREVIOUS = TEST_KEY;
    process.env.CONNECTOR_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
    expect(await vault.get('alice', 'c1')).toEqual({ accessToken: 't' });
    delete process.env.CONNECTOR_ENCRYPTION_KEY_PREVIOUS;
    expect(await vault.get('alice', 'c1')).toBeNull();
  });

  it('fails closed without a valid key', () => {
    process.env.CONNECTOR_ENCRYPTION_KEY = 'too-short';
    expect(EnvKeyProvider.isConfigured()).toBe(false);
    expect(() => new EnvKeyProvider().current()).toThrow();
  });
});
