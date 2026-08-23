import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth.middleware';
import { UserRegistryService } from '../services/user-registry.service';

/**
 * Admin authorization gate. MUST be mounted AFTER `authenticateToken`, which
 * is what populates `req.user`.
 *
 * The role is re-read from Firestore (`users/{uid}.role`) on EVERY request
 * rather than being carried as a claim inside the session JWT. That's
 * deliberate: the app session token lives for 7 days (see
 * APP_SESSION_EXPIRY in auth.middleware.ts), so a role baked into it would
 * keep a demoted admin fully privileged for up to a week. One extra
 * Firestore document read per admin API call is a cheap price for revocation
 * that takes effect immediately.
 */
export async function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const uid = req.user?.uid;

  if (!uid) {
    // Reaching here means requireAdmin was mounted without authenticateToken
    // in front of it - treat as unauthenticated rather than silently allowing.
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication is required before an admin check can run.',
    });
    return;
  }

  // Check if session token carries admin role
  if (req.user?.role === 'admin') {
    next();
    return;
  }

  try {
    const role = await UserRegistryService.getUserRole(uid);

    if (role !== 'admin') {
      res.status(403).json({ error: 'Forbidden', message: 'Admin access required.' });
      return;
    }

    next();
  } catch (error) {
    console.error('[Admin Middleware] Role lookup failed:', error);
    res.status(403).json({ error: 'Forbidden', message: 'Admin access required.' });
  }
}
