import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/admin.middleware';
import { UserRegistryService, UserRole } from '../services/user-registry.service';
import { AnalyticsService, parseWindowDays } from '../services/analytics.service';
import { StorageMetricsService } from '../storage/metrics';
import { ModelConfigService } from '../services/model-config.service';
import { SystemLimitsService } from '../services/system-limits.service';
import { AnonUsageService } from '../services/anon-usage.service';
import { runEmulatedPipeline } from '../emulator/emulator.service';

/**
 * Admin-only API, mounted at /api/v1/admin (see main.ts). Backs the separate
 * apps/admin-analytics Angular app.
 *
 * EVERY route here is behind `authenticateToken` (valid app session token)
 * then `requireAdmin` (fresh Postgres role read - never a JWT claim). The
 * router-level `use` below is what enforces that, so a route added later
 * can't accidentally be left unguarded.
 */
const router = Router();

router.use(authenticateToken, requireAdmin);

/**
 * GET /api/v1/admin/users
 * Every registered user with their current role.
 */
router.get('/users', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const users = await UserRegistryService.getAllUsers();
    res.json({
      users: users.map((user) => ({
        uid: user.uid,
        email: user.email ?? null,
        name: user.name ?? null,
        picture: user.picture ?? null,
        role: user.role ?? 'user',
        lastLogin: user.lastLogin ?? null,
      })),
      count: users.length,
    });
  } catch (error) {
    console.error('[Admin Route] Failed to list users:', error);
    res.status(500).json({ error: 'Failed to load users.' });
  }
});

/**
 * PATCH /api/v1/admin/users/:uid/role
 * Body: { role: 'admin' | 'user' }
 *
 * Guards against demoting the LAST remaining admin - there is currently
 * exactly one, and letting it demote itself would lock every human out of
 * this API permanently (the only recovery would be editing Postgres by
 * hand or re-running the migration script).
 */
router.patch('/users/:uid/role', async (req: AuthenticatedRequest, res: Response) => {
  const { uid } = req.params;
  const role = req.body?.role as unknown;

  if (role !== 'admin' && role !== 'user') {
    res.status(400).json({
      error: 'InvalidRole',
      message: "Body must be { role: 'admin' | 'user' }.",
    });
    return;
  }

  try {
    const currentRole = await UserRegistryService.getUserRole(uid);

    if (currentRole === 'admin' && role === 'user') {
      const adminCount = await UserRegistryService.countAdmins();
      if (adminCount <= 1) {
        res.status(400).json({
          error: 'LastAdmin',
          message:
            'This is the only remaining admin. Promote another user to admin before demoting this one, ' +
            'otherwise nobody would be able to access the admin console.',
        });
        return;
      }
    }

    const updated = await UserRegistryService.setUserRole(uid, role as UserRole);
    if (!updated) {
      res.status(404).json({ error: 'NotFound', message: 'No such user.' });
      return;
    }

    res.json({
      success: true,
      user: {
        uid: updated.uid,
        email: updated.email ?? null,
        name: updated.name ?? null,
        role: updated.role ?? 'user',
        lastLogin: updated.lastLogin ?? null,
      },
    });
  } catch (error) {
    console.error('[Admin Route] Failed to update role:', error);
    res.status(500).json({ error: 'Failed to update user role.' });
  }
});

/**
 * GET /api/v1/admin/usage/summary?days=30
 * Headline KPIs + the dense daily series the dashboard chart plots.
 *
 * Both are real SQL GROUP BY/SUM queries (see services/analytics.service.ts) -
 * no in-app scanning, no truncation risk, regardless of table size.
 */
router.get('/usage/summary', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const days = parseWindowDays(req.query.days);
    const [summary, daily, users] = await Promise.all([
      AnalyticsService.getUsageSummary(days),
      AnalyticsService.aggregateDaily(days),
      UserRegistryService.getAllUsers(),
    ]);

    res.json({ summary, daily, totalUsers: users.length });
  } catch (error) {
    console.error('[Admin Route] Failed to build usage summary:', error);
    res.status(500).json({ error: 'Failed to load usage summary.' });
  }
});

/**
 * GET /api/v1/admin/usage/by-user?days=30
 * Per-user token/cost consumption, enriched with the user registry so the
 * table shows an email rather than a bare uid.
 */
router.get('/usage/by-user', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const days = parseWindowDays(req.query.days);
    const [aggregates, users] = await Promise.all([AnalyticsService.aggregateByUser(days), UserRegistryService.getAllUsers()]);

    const byUid = new Map(users.map((user) => [user.uid, user]));
    const enriched = aggregates.map((entry) => {
      const user = byUid.get(entry.userId);
      return {
        ...entry,
        email: user?.email ?? (entry.userId === 'anonymous' ? 'anonymous (unauthenticated trial)' : null),
        name: user?.name ?? null,
        role: user?.role ?? 'user',
      };
    });

    res.json({ windowDays: days, truncated: false, users: enriched, count: enriched.length });
  } catch (error) {
    console.error('[Admin Route] Failed to build per-user usage:', error);
    res.status(500).json({ error: 'Failed to load per-user usage.' });
  }
});

/**
 * GET /api/v1/admin/usage/by-model?days=30
 */
router.get('/usage/by-model', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const days = parseWindowDays(req.query.days);
    const models = await AnalyticsService.aggregateByModel(days);

    res.json({ windowDays: days, truncated: false, models, count: models.length });
  } catch (error) {
    console.error('[Admin Route] Failed to build per-model usage:', error);
    res.status(500).json({ error: 'Failed to load per-model usage.' });
  }
});

/**
 * GET /api/v1/admin/usage/by-purpose?days=30
 * "How much of this spend is answering users vs. background housekeeping"
 * (summarization/memory extraction/follow-up suggestions) - see
 * PurposeUsageAggregate's doc comment in analytics.service.ts.
 */
router.get('/usage/by-purpose', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const days = parseWindowDays(req.query.days);
    const purposes = await AnalyticsService.aggregateByPurpose(days);

    res.json({ windowDays: days, truncated: false, purposes, count: purposes.length });
  } catch (error) {
    console.error('[Admin Route] Failed to build per-purpose usage:', error);
    res.status(500).json({ error: 'Failed to load per-purpose usage.' });
  }
});

/**
 * GET /api/v1/admin/usage/records?userId=&limit=&days=
 * Session-level drill-down: the individual logged requests behind the
 * aggregates above. `truncated` is now an exact COUNT(*), not a scan-cap
 * guess (see AnalyticsService.getUsageRecords).
 */
router.get('/usage/records', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const days = parseWindowDays(req.query.days);
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const userId = typeof req.query.userId === 'string' && req.query.userId ? req.query.userId : null;

    const { records, totalMatching, truncated } = await AnalyticsService.getUsageRecords(days, userId, limit);

    res.json({
      windowDays: days,
      userId,
      truncated,
      records,
      count: records.length,
      totalMatching,
    });
  } catch (error) {
    console.error('[Admin Route] Failed to load usage records:', error);
    res.status(500).json({ error: 'Failed to load usage records.' });
  }
});

/**
 * GET /api/v1/admin/storage
 * GCS bucket size/cost. Same StorageMetricsService that used to back the
 * chat-client Settings > Storage tab - that tab was removed in favour of
 * this admin-only view rather than the capability being dropped.
 */
router.get('/storage', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const metrics = await new StorageMetricsService().getBucketMetrics();
    res.json(metrics);
  } catch (error) {
    console.error('[Admin Route] Storage metrics error:', error);
    res.status(500).json({ error: 'Failed to fetch storage metrics.' });
  }
});

/**
 * GET /api/v1/admin/models/catalog
 * Fetches the live OpenRouter model catalog (with token pricing, context length, modalities).
 */
router.get('/models/catalog', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    const models = await ModelConfigService.fetchOpenRouterCatalog(forceRefresh);
    res.json({ models, count: models.length });
  } catch (error) {
    console.error('[Admin Route] Failed to fetch model catalog:', error);
    res.status(500).json({ error: 'Failed to fetch model catalog.' });
  }
});

/**
 * GET /api/v1/admin/models/config
 * Reads the active dynamic model configuration from Postgres.
 */
router.get('/models/config', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const config = await ModelConfigService.getModelConfig();
    res.json(config);
  } catch (error) {
    console.error('[Admin Route] Failed to read model config:', error);
    res.status(500).json({ error: 'Failed to read model configuration.' });
  }
});

/**
 * PUT /api/v1/admin/models/config
 * Updates the active model configuration (enabled models, default model) in Postgres.
 */
router.put('/models/config', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { defaultModel, models } = req.body || {};
    if (!Array.isArray(models)) {
      res.status(400).json({ error: 'Invalid payload: "models" array is required.' });
      return;
    }

    const savedConfig = await ModelConfigService.saveModelConfig({ defaultModel, models });
    res.json({ success: true, config: savedConfig });
  } catch (error) {
    console.error('[Admin Route] Failed to save model config:', error);
    res.status(500).json({ error: 'Failed to save model configuration.' });
  }
});

/**
 * GET /api/v1/admin/limits
 * Reads the active operational limits (rate limits + upload size/count
 * caps) from Postgres - see services/system-limits.service.ts.
 */
router.get('/limits', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limits = await SystemLimitsService.getLimits();
    res.json(limits);
  } catch (error) {
    console.error('[Admin Route] Failed to read system limits:', error);
    res.status(500).json({ error: 'Failed to read system limits.' });
  }
});

/**
 * PUT /api/v1/admin/limits
 * Updates the operational limits in Postgres. Every field is clamped to a
 * hard safety range by SystemLimitsService.saveLimits() itself, so a
 * malformed/out-of-range value here can't lock everyone out or open an
 * unbounded upload hole - it's silently clamped rather than rejected.
 */
router.put('/limits', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const savedLimits = await SystemLimitsService.saveLimits(req.body || {});
    res.json({ success: true, limits: savedLimits });
  } catch (error) {
    console.error('[Admin Route] Failed to save system limits:', error);
    res.status(500).json({ error: 'Failed to save system limits.' });
  }
});

/**
 * GET /api/v1/admin/limits/usage
 * Read-only snapshot of every currently-tracked rate-limit key (signed-in
 * users AND anonymous IPs) against its current cap - "how much of today's
 * quota is occupied" for the admin console's Limits view. Never consumes a
 * counter (see AnonUsageService.listUsageSnapshot).
 */
router.get('/limits/usage', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const entries = await AnonUsageService.listUsageSnapshot();
    res.json({ entries, count: entries.length });
  } catch (error) {
    console.error('[Admin Route] Failed to read rate-limit usage snapshot:', error);
    res.status(500).json({ error: 'Failed to read rate-limit usage.' });
  }
});

/**
 * POST /api/v1/admin/emulator/stream
 * Body: { query: string }
 * SSE endpoint emitting step-by-step pipeline emulation events.
 */
router.post('/emulator/stream', async (req: AuthenticatedRequest, res: Response) => {
  const query = req.body?.query || 'Explain how the quantum routing agent works.';
  try {
    await runEmulatedPipeline(query, res);
  } catch (error) {
    console.error('[Admin Route] Emulator stream failed:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Emulator stream error.' });
    }
  }
});

export default router;
