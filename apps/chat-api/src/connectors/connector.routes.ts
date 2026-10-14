import { Router, Request, Response } from 'express';
import { ApprovalState, ConnectorCapability } from '@chat-monorepo/shared';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.middleware';
import { getConnectorPlatform } from './connector-platform';
import { ConnectorConfig } from './connector-config';
import { ConnectorError } from './connector-manager';
import { toApprovalSummary } from './approval-service';
import { invalidateConnectorTools } from './langchain-tools';

/**
 * Connector settings API, mounted at /api/v1/connectors.
 *
 * Every route except the OAuth callback sits behind authenticateToken and
 * resolves resources through the owner-scoped services, so another user's
 * connection or approval id behaves exactly like a nonexistent one (404).
 * Responses carry metadata only - tokens never leave the server.
 */
const router = Router();

const BINDING_COOKIE = 'nexus_connector_oauth';
const CALLBACK_PATH = '/api/v1/connectors/oauth/callback';
const CAPABILITIES: ConnectorCapability[] = ['read', 'write'];
const APPROVAL_STATES: ApprovalState[] = ['pending', 'approved', 'rejected', 'executed', 'failed', 'expired'];

function parseCapabilities(raw: unknown): ConnectorCapability[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.some((c) => !CAPABILITIES.includes(c))) return undefined;
  return raw as ConnectorCapability[];
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

function bindingCookie(value: string, maxAgeSeconds: number): string {
  const secure = ConnectorConfig.publicBaseUrl().startsWith('https://') ? '; Secure' : '';
  return `${BINDING_COOKIE}=${encodeURIComponent(value)}; Path=${CALLBACK_PATH}; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

function sendError(res: Response, error: unknown, fallback: string): void {
  if (error instanceof ConnectorError) {
    res.status(error.status).json({ error: error.code, message: error.message });
    return;
  }
  console.error(`[Connector Route] ${fallback}:`, (error as Error)?.message);
  res.status(500).json({ error: 'InternalError', message: fallback });
}

/** GET /providers - every connector, its tools, and whether this server can offer it. */
router.get('/providers', authenticateToken, (_req, res) => {
  res.json({
    enabled: ConnectorConfig.enabled(),
    writesEnabled: ConnectorConfig.writesEnabled(),
    providers: getConnectorPlatform().registry.listProviderSummaries(),
  });
});

/** GET /connections - the caller's linked accounts (metadata only). */
router.get('/connections', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    res.json({ connections: await getConnectorPlatform().manager.listConnections(req.user!.uid) });
  } catch (error) {
    sendError(res, error, 'Failed to load connections.');
  }
});

/** GET /tools - tools usable by the caller right now (what the agent will be offered). */
router.get('/tools', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const platform = getConnectorPlatform();
    const tools = await platform.executor.listUsableTools({ uid: req.user!.uid, client: 'nexus' });
    res.json({ tools: tools.map(({ adapter, tool }) => ({ providerId: adapter.id, ...platform.registry.toToolSummary(tool) })) });
  } catch (error) {
    sendError(res, error, 'Failed to load tools.');
  }
});

/**
 * POST /:providerId/connect {capabilities?} - starts linking. OAuth providers
 * get an authorize URL (and the HttpOnly browser-binding cookie); built-in
 * providers are connected immediately.
 */
router.post('/:providerId/connect', authenticateToken, async (req: AuthenticatedRequest, res) => {
  const capabilities = parseCapabilities(req.body?.capabilities);
  if (req.body?.capabilities !== undefined && !capabilities) {
    res.status(400).json({ error: 'InvalidRequest', message: '"capabilities" must be an array of "read" | "write".' });
    return;
  }
  try {
    const result = await getConnectorPlatform().manager.beginConnect(req.user!.uid, req.params.providerId, capabilities);
    invalidateConnectorTools(req.user!.uid);
    if (result.kind === 'redirect') {
      res.setHeader('Set-Cookie', bindingCookie(result.bindingNonce, Math.floor(ConnectorConfig.oauthStateTtlMs() / 1000)));
      res.json({ authorizeUrl: result.authorizeUrl });
    } else {
      res.status(201).json({ connection: result.connection });
    }
  } catch (error) {
    sendError(res, error, 'Failed to start connecting.');
  }
});

/**
 * GET /oauth/callback - the provider's redirect target. Unauthenticated by
 * necessity (it's a top-level browser navigation from the provider); the
 * single-use, user-bound state plus the browser-binding cookie stand in for
 * the session. Always ends in a redirect back to the SPA with a coarse status
 * code - never reflects provider text or tokens into the URL.
 */
router.get('/oauth/callback', async (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Set-Cookie', bindingCookie('', 0));
  const app = ConnectorConfig.appBaseUrl() || '';
  const q = (v: unknown) => (typeof v === 'string' ? v : undefined);
  try {
    const { providerId, ownerUid } = await getConnectorPlatform().manager.completeOAuth({
      state: q(req.query.state),
      code: q(req.query.code),
      error: q(req.query.error),
      bindingNonce: readCookie(req, BINDING_COOKIE),
    });
    invalidateConnectorTools(ownerUid);
    res.redirect(302, `${app}/?connector=${encodeURIComponent(providerId)}&connectorStatus=connected`);
  } catch (error) {
    const code = error instanceof ConnectorError ? error.code : 'InternalError';
    if (!(error instanceof ConnectorError)) console.error('[Connector Route] OAuth callback failed:', (error as Error)?.message);
    res.redirect(302, `${app}/?connectorStatus=error&connectorError=${encodeURIComponent(code)}`);
  }
});

/** PATCH /connections/:id {enabledCapabilities} - may answer with a re-authorization URL (incremental consent). */
router.patch('/connections/:id', authenticateToken, async (req: AuthenticatedRequest, res) => {
  const capabilities = parseCapabilities(req.body?.enabledCapabilities);
  if (!capabilities) {
    res.status(400).json({ error: 'InvalidRequest', message: '"enabledCapabilities" must be an array of "read" | "write".' });
    return;
  }
  try {
    const platform = getConnectorPlatform();
    const result = await platform.manager.setCapabilities(req.user!.uid, req.params.id, capabilities);
    platform.executor.forgetConnection(req.params.id);
    invalidateConnectorTools(req.user!.uid);
    if ('reauthorize' in result) {
      if (result.reauthorize.kind === 'redirect') {
        res.setHeader('Set-Cookie', bindingCookie(result.reauthorize.bindingNonce, Math.floor(ConnectorConfig.oauthStateTtlMs() / 1000)));
        res.json({ authorizeUrl: result.reauthorize.authorizeUrl });
      } else {
        res.json({ connection: result.reauthorize.connection });
      }
      return;
    }
    res.json({ connection: result.connection });
  } catch (error) {
    sendError(res, error, 'Failed to update the connection.');
  }
});

/** POST /connections/:id/check - verifies the grant still works and refreshes status. */
router.post('/connections/:id/check', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const connection = await getConnectorPlatform().manager.checkConnection(req.user!.uid, req.params.id);
    invalidateConnectorTools(req.user!.uid);
    res.json({ connection });
  } catch (error) {
    sendError(res, error, 'Failed to check the connection.');
  }
});

/** DELETE /connections/:id - revokes at the provider (best-effort) and deletes local secrets + data. */
router.delete('/connections/:id', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const removed = await getConnectorPlatform().disconnect(req.user!.uid, req.params.id);
    invalidateConnectorTools(req.user!.uid);
    if (!removed) {
      res.status(404).json({ error: 'NotFound', message: 'Connection not found.' });
      return;
    }
    res.status(204).end();
  } catch (error) {
    sendError(res, error, 'Failed to disconnect.');
  }
});

/** GET /approvals?state=pending - the caller's approval requests. */
router.get('/approvals', authenticateToken, async (req: AuthenticatedRequest, res) => {
  const state = typeof req.query.state === 'string' ? (req.query.state as ApprovalState) : undefined;
  if (state && !APPROVAL_STATES.includes(state)) {
    res.status(400).json({ error: 'InvalidRequest', message: 'Unknown approval state.' });
    return;
  }
  try {
    res.json({ approvals: await getConnectorPlatform().approvals.list(req.user!.uid, state) });
  } catch (error) {
    sendError(res, error, 'Failed to load approvals.');
  }
});

/** GET /approvals/:id - fresh server-side view of one approval (the card re-reads this before acting). */
router.get('/approvals/:id', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const platform = getConnectorPlatform();
    const record = await platform.approvals.get(req.user!.uid, req.params.id);
    if (!record) {
      res.status(404).json({ error: 'NotFound', message: 'Approval not found.' });
      return;
    }
    res.json({ approval: toApprovalSummary(record) });
  } catch (error) {
    sendError(res, error, 'Failed to load the approval.');
  }
});

/**
 * POST /approvals/:id/decision {decision: 'approve' | 'reject'} - the only
 * way a connector write ever executes. Must come from the signed-in owner via
 * the app session; nothing the model says can reach this.
 */
router.post('/approvals/:id/decision', authenticateToken, async (req: AuthenticatedRequest, res) => {
  const decision = req.body?.decision;
  if (decision !== 'approve' && decision !== 'reject') {
    res.status(400).json({ error: 'InvalidRequest', message: '"decision" must be "approve" or "reject".' });
    return;
  }
  try {
    const outcome = await getConnectorPlatform().decideApproval(req.user!.uid, req.params.id, decision);
    if (!outcome.ok) {
      res.status(outcome.status).json({ error: 'ApprovalUnavailable', message: outcome.message });
      return;
    }
    res.json({ approval: outcome.approval, result: outcome.result });
  } catch (error) {
    sendError(res, error, 'Failed to process the decision.');
  }
});

/** GET /audit - the caller's redacted connector history. */
router.get('/audit', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    res.json({ events: await getConnectorPlatform().audit.listForUser(req.user!.uid) });
  } catch (error) {
    sendError(res, error, 'Failed to load history.');
  }
});

export default router;
