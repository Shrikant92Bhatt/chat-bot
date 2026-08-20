import { Router, Response } from 'express';
import { authenticateToken, AuthenticatedRequest } from '../middleware/auth.middleware';
import { requireAdmin } from '../middleware/admin.middleware';
import { UserRegistryService, UserRole } from '../services/user-registry.service';
import { AnalyticsService, parseWindowDays } from '../services/analytics.service';
import { StorageMetricsService } from '../storage/metrics';
import { ModelConfigService } from '../services/model-config.service';

/**
 * Admin-only API, mounted at /api/v1/admin (see main.ts). Backs the separate
 * apps/admin-analytics Angular app.
 *
 * EVERY route here is behind `authenticateToken` (valid app session token)
 * then `requireAdmin` (fresh Firestore role read - never a JWT claim). The
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
 * this API permanently (the only recovery would be editing Firestore by
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
 * Aggregated in-app because Firestore has no server-side GROUP BY - see the
 * scaling caveat at the top of services/analytics.service.ts (short version:
 * this is one document read per logged chat request, fine at app scale,
 * and a scheduled BigQuery export is the intended path at real volume).
 */
router.get('/usage/summary', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const days = parseWindowDays(req.query.days);
    const { records, truncated } = await AnalyticsService.getUsageWindow(days);

    res.json({
      summary: AnalyticsService.summarize(records, days, truncated),
      daily: AnalyticsService.aggregateDaily(records, days),
      totalUsers: (await UserRegistryService.getAllUsers()).length,
    });
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
    const [{ records, truncated }, users] = await Promise.all([
      AnalyticsService.getUsageWindow(days),
      UserRegistryService.getAllUsers(),
    ]);

    const byUid = new Map(users.map((user) => [user.uid, user]));
    const aggregates = AnalyticsService.aggregateByUser(records).map((entry) => {
      const user = byUid.get(entry.userId);
      return {
        ...entry,
        email: user?.email ?? (entry.userId === 'anonymous' ? 'anonymous (unauthenticated trial)' : null),
        name: user?.name ?? null,
        role: user?.role ?? 'user',
      };
    });

    res.json({ windowDays: days, truncated, users: aggregates, count: aggregates.length });
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
    const { records, truncated } = await AnalyticsService.getUsageWindow(days);
    const models = AnalyticsService.aggregateByModel(records);

    res.json({ windowDays: days, truncated, models, count: models.length });
  } catch (error) {
    console.error('[Admin Route] Failed to build per-model usage:', error);
    res.status(500).json({ error: 'Failed to load per-model usage.' });
  }
});

/**
 * GET /api/v1/admin/usage/records?userId=&limit=&days=
 * Session-level drill-down: the individual logged requests behind the
 * aggregates above.
 *
 * `userId` is applied in process rather than as a second `where()` clause on
 * purpose - `where('userId','==',x).orderBy('timestamp')` needs a composite
 * index that isn't provisioned in this repo (see PROJECT_CONTEXT.md's known
 * gaps), whereas the timestamp-only query here needs none.
 */
router.get('/usage/records', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const days = parseWindowDays(req.query.days);
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const userId = typeof req.query.userId === 'string' && req.query.userId ? req.query.userId : null;

    const { records, truncated } = await AnalyticsService.getUsageWindow(days);

    const filtered = userId
      ? records.filter((record) => (record.userId ?? 'anonymous') === userId)
      : records;

    res.json({
      windowDays: days,
      userId,
      truncated,
      records: filtered.slice(0, limit),
      count: Math.min(filtered.length, limit),
      totalMatching: filtered.length,
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
 * Reads the active dynamic model configuration from Firestore.
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
 * Updates the active model configuration (enabled models, default model) in Firestore.
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

export default router;
