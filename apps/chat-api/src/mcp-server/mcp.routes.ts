import express, { Request, Response, Router } from 'express';
import cors from 'cors';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.middleware';
import { getConnectorPlatform } from '../connectors/connector-platform';
import { ConnectorConfig } from '../connectors/connector-config';
import { FirestoreRateLimiter, RateLimiter } from '../connectors/reliability';
import { McpOAuthService, OAuthError, mcpIssuer, mcpUnavailableReason } from './mcp-oauth.service';
import { handleMcpRequest } from './remote-mcp-server';

/**
 * HTTP surface for the remote MCP server (plan §9 / Phase 4):
 *
 *   /.well-known/oauth-protected-resource[/api/mcp]   RFC 9728
 *   /.well-known/oauth-authorization-server           RFC 8414
 *   /api/oauth/{register,authorize,token,revoke}      the authorization server
 *   /api/mcp                                          the MCP endpoint (Bearer)
 *   /api/v1/mcp-oauth/{consent,grants}                SPA consent + grant management (app session)
 *
 * Mounted ahead of the app-wide CORS middleware: MCP clients and inspectors
 * call these cross-origin with bearer tokens (never cookies), so they get a
 * permissive, credential-less CORS policy of their own. Everything 404s
 * while the MCP server is disabled or misconfigured.
 */

let oauthService: McpOAuthService | null = null;
function oauth(): McpOAuthService {
  if (!oauthService) oauthService = new McpOAuthService(getConnectorPlatform().store);
  return oauthService;
}
let limiter: RateLimiter = new FirestoreRateLimiter();

/** Test seams. */
export function setMcpOAuthServiceForTesting(service: McpOAuthService | null, rateLimiter?: RateLimiter): void {
  oauthService = service;
  if (rateLimiter) limiter = rateLimiter;
}

const openCors = cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Mcp-Protocol-Version', 'Mcp-Session-Id', 'Last-Event-ID'],
  exposedHeaders: ['WWW-Authenticate', 'Mcp-Session-Id'],
});

function enabledOr404(_req: Request, res: Response, next: () => void): void {
  if (mcpUnavailableReason()) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  next();
}

function sendOAuthError(res: Response, error: unknown): void {
  if (error instanceof OAuthError) {
    res.status(error.status).json({ error: error.error, error_description: error.description });
    return;
  }
  console.error('[MCP OAuth] Unexpected error:', (error as Error)?.message);
  res.status(500).json({ error: 'server_error' });
}

async function throttle(req: Request, res: Response, bucket: string, limit: number): Promise<boolean> {
  const result = await limiter.consume(`mcp-oauth:${bucket}:${req.ip ?? 'unknown'}`, limit, 60 * 60 * 1000).catch(() => ({ allowed: true, resetAt: 0 }));
  if (!result.allowed) {
    res.status(429).json({ error: 'slow_down', error_description: 'Too many requests.' });
    return false;
  }
  return true;
}

const resourceMetadataUrl = () => `${mcpIssuer()}/.well-known/oauth-protected-resource/api/mcp`;

// ---------------- discovery + authorization server + MCP (public, open CORS) ----------------

export const mcpPublicRouter = Router();
mcpPublicRouter.use(['/.well-known', '/api/oauth', '/api/mcp'], openCors, enabledOr404);

mcpPublicRouter.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/api/mcp'], (_req, res) => {
  res.json(oauth().protectedResourceMetadata());
});

mcpPublicRouter.get('/.well-known/oauth-authorization-server', (_req, res) => {
  res.json(oauth().authorizationServerMetadata());
});

const parseForm = express.urlencoded({ extended: false, limit: '20kb' });

mcpPublicRouter.post('/api/oauth/register', async (req, res) => {
  if (!(await throttle(req, res, 'register', 30))) return;
  try {
    res.status(201).json(await oauth().registerClient(req.body ?? {}));
  } catch (error) {
    sendOAuthError(res, error);
  }
});

/**
 * Validates the request, then hands the browser to the SPA's consent screen
 * (where the user is signed in with their normal NexusAI session). Invalid
 * client/redirect errors are shown here, never redirected to an unverified URI.
 */
mcpPublicRouter.get('/api/oauth/authorize', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const q = Object.fromEntries(Object.entries(req.query).map(([k, v]) => [k, typeof v === 'string' ? v : undefined]));
  try {
    const consent = await oauth().validateAuthorizeRequest(q);
    const app = ConnectorConfig.appBaseUrl();
    res.redirect(302, `${app}/?mcpConsent=${encodeURIComponent(consent)}`);
  } catch (error) {
    const message = error instanceof OAuthError ? error.description : 'Authorization failed.';
    res.status(error instanceof OAuthError ? error.status : 500).type('text/plain').send(`NexusAI authorization error: ${message}`);
  }
});

mcpPublicRouter.post('/api/oauth/token', parseForm, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!(await throttle(req, res, 'token', 300))) return;
  try {
    res.json(await oauth().token(req.body ?? {}));
  } catch (error) {
    sendOAuthError(res, error);
  }
});

mcpPublicRouter.post('/api/oauth/revoke', parseForm, async (req, res) => {
  await oauth().revokeToken(typeof req.body?.token === 'string' ? req.body.token : undefined).catch(() => undefined);
  // RFC 7009: respond 200 whether or not the token existed.
  res.status(200).end();
});

mcpPublicRouter.post('/api/mcp', async (req, res) => {
  const header = req.headers.authorization;
  const challenge = (extra = '') =>
    `Bearer resource_metadata="${resourceMetadataUrl()}", scope="nexus.read"${extra}`;
  if (!header?.startsWith('Bearer ')) {
    res.setHeader('WWW-Authenticate', challenge());
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const claims = await oauth().verifyAccessToken(header.slice(7).trim());
  if (!claims) {
    res.setHeader('WWW-Authenticate', challenge(', error="invalid_token"'));
    res.status(401).json({ error: 'invalid_token' });
    return;
  }
  const quota = await limiter.consume(`mcp:${claims.sub}`, 600, 60 * 60 * 1000).catch(() => ({ allowed: true, resetAt: 0 }));
  if (!quota.allowed) {
    res.status(429).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Rate limit exceeded.' }, id: null });
    return;
  }
  try {
    await handleMcpRequest(getConnectorPlatform(), claims.sub, req, res, req.body);
  } catch (error) {
    console.error('[MCP] Request failed:', (error as Error)?.message);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
  }
});

// Stateless server: no standalone SSE stream and no sessions to delete.
mcpPublicRouter.all('/api/mcp', (_req, res) => {
  res.setHeader('Allow', 'POST');
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
});

// ---------------- SPA consent + grant management (NexusAI app session) ----------------

export const mcpAccountRouter = Router();
mcpAccountRouter.use(enabledOr404);

/** GET /consent?request=... - what the consent screen shows. */
mcpAccountRouter.get('/consent', authenticateToken, (req: AuthenticatedRequest, res) => {
  try {
    const r = oauth().readConsentRequest(String(req.query.request ?? ''));
    res.json({ clientName: r.clientName, redirectHost: new URL(r.redirectUri).host, scopes: r.scope.split(' ') });
  } catch (error) {
    sendOAuthError(res, error);
  }
});

/** POST /consent {request, decision} - returns where to send the browser. */
mcpAccountRouter.post('/consent', authenticateToken, async (req: AuthenticatedRequest, res) => {
  const { request, decision } = req.body ?? {};
  if (typeof request !== 'string' || (decision !== 'approve' && decision !== 'deny')) {
    res.status(400).json({ error: 'invalid_request', error_description: '"request" and "decision" (approve|deny) are required.' });
    return;
  }
  try {
    res.json({ redirectUrl: await oauth().decide(req.user!.uid, request, decision === 'approve') });
  } catch (error) {
    sendOAuthError(res, error);
  }
});

mcpAccountRouter.get('/grants', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    res.json({ grants: await oauth().listGrants(req.user!.uid) });
  } catch (error) {
    sendOAuthError(res, error);
  }
});

mcpAccountRouter.delete('/grants/:id', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const removed = await oauth().revokeGrant(req.user!.uid, req.params.id);
    if (!removed) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.status(204).end();
  } catch (error) {
    sendOAuthError(res, error);
  }
});

/** GET /status - whether the MCP server is on (for the settings screen; no auth needed). */
export function mcpStatus() {
  const reason = mcpUnavailableReason();
  return { enabled: !reason, ...(reason ? { reason } : { endpoint: `${mcpIssuer()}/api/mcp` }) };
}
