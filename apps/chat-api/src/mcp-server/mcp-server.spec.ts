import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.APP_SESSION_SECRET = 'app-session-secret-for-tests-0123456789abcdef';
  process.env.MCP_OAUTH_SIGNING_SECRET = 'mcp-signing-secret-for-tests-0123456789abcdef';
  process.env.MCP_SERVER_ENABLED = 'true';
});

import crypto from 'crypto';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import { McpOAuthService, isAcceptableRedirectUri } from './mcp-oauth.service';
import { mcpAccountRouter, mcpPublicRouter, setMcpOAuthServiceForTesting } from './mcp.routes';
import { setConnectorPlatformForTesting } from '../connectors/connector-platform';
import { mintAppSessionToken } from '../middleware/auth.middleware';
import { MemoryRateLimiter } from '../connectors/reliability';
import { createTestPlatform, FakeCalls, newCalls, setConnectorTestEnv } from '../connectors/testing/fake-connector';

const ALICE = 'uid-alice';
const REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';

const pkce = () => {
  const verifier = crypto.randomBytes(32).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
};

describe('MCP OAuth authorization server', () => {
  let calls: FakeCalls;
  let ctx: ReturnType<typeof createTestPlatform>;
  let oauth: McpOAuthService;

  beforeEach(() => {
    setConnectorTestEnv();
    process.env.MCP_SERVER_ENABLED = 'true';
    process.env.MCP_OAUTH_SIGNING_SECRET = 'mcp-signing-secret-for-tests-0123456789abcdef';
    calls = newCalls();
    ctx = createTestPlatform(calls);
    oauth = new McpOAuthService(ctx.store);
  });

  async function authorize(clientId: string, challenge: string) {
    const consent = await oauth.validateAuthorizeRequest({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'xyz',
      resource: 'https://nexus.test/api/mcp',
    });
    const redirect = new URL(await oauth.decide(ALICE, consent, true));
    return redirect;
  }

  it('publishes RFC 9728 / RFC 8414 metadata pointing at this deployment', () => {
    expect(oauth.protectedResourceMetadata()).toMatchObject({ resource: 'https://nexus.test/api/mcp', authorization_servers: ['https://nexus.test'] });
    expect(oauth.authorizationServerMetadata()).toMatchObject({
      issuer: 'https://nexus.test',
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    });
  });

  it('only registers clients with allowed https redirect URIs', async () => {
    expect(isAcceptableRedirectUri(REDIRECT)).toBe(true);
    expect(isAcceptableRedirectUri('http://localhost:6274/callback')).toBe(true);
    expect(isAcceptableRedirectUri('https://evil.example/cb')).toBe(false);
    expect(isAcceptableRedirectUri('http://chatgpt.com/cb')).toBe(false);
    await expect(oauth.registerClient({ redirect_uris: ['https://evil.example/cb'] })).rejects.toMatchObject({ error: 'invalid_redirect_uri' });
    await expect(oauth.registerClient({ redirect_uris: [REDIRECT], token_endpoint_auth_method: 'client_secret_basic' })).rejects.toMatchObject({
      error: 'invalid_client_metadata',
    });
  });

  it('requires PKCE S256 and a registered redirect URI', async () => {
    const client = await oauth.registerClient({ redirect_uris: [REDIRECT], client_name: 'ChatGPT' });
    const base = { response_type: 'code', client_id: client.client_id as string, redirect_uri: REDIRECT };
    await expect(oauth.validateAuthorizeRequest(base)).rejects.toMatchObject({ error: 'invalid_request' });
    await expect(oauth.validateAuthorizeRequest({ ...base, code_challenge: pkce().challenge, code_challenge_method: 'plain' })).rejects.toMatchObject({
      error: 'invalid_request',
    });
    await expect(
      oauth.validateAuthorizeRequest({ ...base, redirect_uri: 'https://chatgpt.com/other', code_challenge: pkce().challenge, code_challenge_method: 'S256' })
    ).rejects.toMatchObject({ error: 'invalid_request' });
  });

  it('runs the full code + PKCE flow, single-use codes, rotating refresh tokens and immediate revocation', async () => {
    const client = await oauth.registerClient({ redirect_uris: [REDIRECT], client_name: 'ChatGPT' });
    const clientId = client.client_id as string;
    const { verifier, challenge } = pkce();
    const redirect = await authorize(clientId, challenge);
    expect(redirect.searchParams.get('state')).toBe('xyz');
    expect(redirect.searchParams.get('iss')).toBe('https://nexus.test');
    const code = redirect.searchParams.get('code')!;

    await expect(oauth.token({ grant_type: 'authorization_code', code, code_verifier: 'wrong', client_id: clientId, redirect_uri: REDIRECT })).rejects.toMatchObject({
      error: 'invalid_grant',
    });
    // The failed attempt consumed the code.
    await expect(oauth.token({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT })).rejects.toMatchObject({
      error: 'invalid_grant',
    });

    const second = pkce();
    const code2 = (await authorize(clientId, second.challenge)).searchParams.get('code')!;
    const tokens = await oauth.token({ grant_type: 'authorization_code', code: code2, code_verifier: second.verifier, client_id: clientId, redirect_uri: REDIRECT });
    const claims = await oauth.verifyAccessToken(tokens.access_token as string);
    expect(claims).toMatchObject({ sub: ALICE, client_id: clientId, scope: 'nexus.read' });

    const rotated = await oauth.token({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token as string, client_id: clientId });
    await expect(oauth.token({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token as string, client_id: clientId })).rejects.toMatchObject({
      error: 'invalid_grant',
    });

    const [grant] = await oauth.listGrants(ALICE);
    expect(await oauth.revokeGrant('uid-bob', grant.id)).toBe(false);
    expect(await oauth.revokeGrant(ALICE, grant.id)).toBe(true);
    expect(await oauth.verifyAccessToken(rotated.access_token as string)).toBeNull();
    await expect(oauth.token({ grant_type: 'refresh_token', refresh_token: rotated.refresh_token as string, client_id: clientId })).rejects.toMatchObject({
      error: 'invalid_grant',
    });
  });

  it('keeps NexusAI sessions and MCP tokens mutually unusable', async () => {
    const appSession = mintAppSessionToken({ uid: ALICE });
    expect(await oauth.verifyAccessToken(appSession)).toBeNull();

    // An MCP-secret token for a different audience is rejected too.
    const wrongAudience = jwt.sign({ sub: ALICE, client_id: 'c', scope: 'nexus.read', grant_id: 'g' }, process.env.MCP_OAUTH_SIGNING_SECRET!, {
      issuer: 'https://nexus.test',
      audience: 'https://other.example/api/mcp',
    });
    expect(await oauth.verifyAccessToken(wrongAudience)).toBeNull();

    // Reusing the app session secret for MCP disables the MCP server entirely.
    process.env.MCP_OAUTH_SIGNING_SECRET = process.env.APP_SESSION_SECRET;
    expect(await oauth.verifyAccessToken(appSession)).toBeNull();
  });
});

describe('remote MCP endpoint over HTTP', () => {
  let server: HttpServer;
  let base: string;
  let calls: FakeCalls;
  let ctx: ReturnType<typeof createTestPlatform>;
  let oauth: McpOAuthService;

  beforeAll(async () => {
    setConnectorTestEnv();
    process.env.MCP_SERVER_ENABLED = 'true';
    process.env.MCP_OAUTH_SIGNING_SECRET = 'mcp-signing-secret-for-tests-0123456789abcdef';
    calls = newCalls();
    ctx = createTestPlatform(calls);
    setConnectorPlatformForTesting(ctx.platform);
    oauth = new McpOAuthService(ctx.store);
    setMcpOAuthServiceForTesting(oauth, new MemoryRateLimiter());

    const app = express();
    app.use(['/api/mcp', '/api/oauth'], express.json());
    app.use(mcpPublicRouter);
    app.use(express.json());
    app.use('/api/v1/mcp-oauth', mcpAccountRouter);
    server = app.listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
    setConnectorPlatformForTesting(null);
    setMcpOAuthServiceForTesting(null);
  });

  async function accessToken(): Promise<string> {
    const reg = await fetch(`${base}/api/oauth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: 'ChatGPT' }),
    }).then((r) => r.json());
    const { verifier, challenge } = pkce();
    const authorize = await fetch(
      `${base}/api/oauth/authorize?` +
        new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 's' }),
      { redirect: 'manual' }
    );
    expect(authorize.status).toBe(302);
    const consent = new URL(authorize.headers.get('location')!).searchParams.get('mcpConsent')!;

    const session = mintAppSessionToken({ uid: ALICE });
    const shown = await fetch(`${base}/api/v1/mcp-oauth/consent?request=${encodeURIComponent(consent)}`, { headers: { Authorization: `Bearer ${session}` } }).then((r) =>
      r.json()
    );
    expect(shown).toMatchObject({ clientName: 'ChatGPT', redirectHost: 'chatgpt.com', scopes: ['nexus.read'] });
    const decided = await fetch(`${base}/api/v1/mcp-oauth/consent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` },
      body: JSON.stringify({ request: consent, decision: 'approve' }),
    }).then((r) => r.json());
    const code = new URL(decided.redirectUrl).searchParams.get('code')!;

    const token = await fetch(`${base}/api/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: reg.client_id, redirect_uri: REDIRECT }),
    }).then((r) => r.json());
    return token.access_token;
  }

  const rpc = (token: string | null, body: unknown) =>
    fetch(`${base}/api/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'Mcp-Protocol-Version': '2025-06-18',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });

  it('challenges unauthenticated requests with resource metadata', async () => {
    const res = await rpc(null, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata="https://nexus.test/.well-known/oauth-protected-resource/api/mcp"');
    const meta = await fetch(`${base}/.well-known/oauth-protected-resource/api/mcp`).then((r) => r.json());
    expect(meta.resource).toBe('https://nexus.test/api/mcp');
  });

  it('rejects a NexusAI app session token at the MCP endpoint', async () => {
    const res = await rpc(mintAppSessionToken({ uid: ALICE }), { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('error="invalid_token"');
  });

  it('initializes, lists only curated read tools, and calls one through the shared executor', async () => {
    await ctx.platform.manager.beginConnect(ALICE, 'social', ['read', 'write']);
    const token = await accessToken();

    const init = await rpc(token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
    });
    expect(init.status).toBe(200);
    expect((await init.json()).result.serverInfo.name).toBe('nexusai');

    const list = await rpc(token, { jsonrpc: '2.0', id: 2, method: 'tools/list' }).then((r) => r.json());
    const names = list.result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(['nexus_fake_read']); // write + tier-4 tools never exposed
    expect(list.result.tools[0].annotations.readOnlyHint).toBe(true);
    expect(list.result.tools[0].inputSchema.type).toBe('object');
    expect(list.result.tools[0]._meta['openai/outputTemplate']).toBe('ui://widget/nexus-result.html');

    const call = await rpc(token, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'nexus_fake_read', arguments: { query: 'hi' } } }).then((r) =>
      r.json()
    );
    expect(call.result.isError).toBe(false);
    expect(call.result.structuredContent.display.title).toBe('Fake results');
    expect(calls.reads).toBe(1);

    const write = await rpc(token, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'nexus_fake_write', arguments: { target: 't', message: 'm' } },
    }).then((r) => r.json());
    expect(write.result.isError).toBe(true);
    expect(calls.writes).toHaveLength(0);

    const widget = await rpc(token, { jsonrpc: '2.0', id: 5, method: 'resources/read', params: { uri: 'ui://widget/nexus-result.html' } }).then((r) => r.json());
    expect(widget.result.contents[0].mimeType).toBe('text/html+skybridge');
    expect(widget.result.contents[0].text).not.toContain('innerHTML');
  });

  it('is invisible when the MCP server is disabled', async () => {
    process.env.MCP_SERVER_ENABLED = 'false';
    expect((await fetch(`${base}/.well-known/oauth-authorization-server`)).status).toBe(404);
    process.env.MCP_SERVER_ENABLED = 'true';
  });
});
