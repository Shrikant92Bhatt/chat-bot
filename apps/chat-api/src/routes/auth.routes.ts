import { Router, Response } from 'express';
import { verifyGoogleToken, mintAppSessionToken } from '../middleware/auth.middleware';
import { UserRegistryService } from '../services/user-registry.service';

const router = Router();

/**
 * POST /api/auth/session
 * One-time exchange: verifies a raw Google credential (ID token or OAuth2
 * access token, whichever sign-in path the frontend took) and returns the
 * app's own long-lived session token. Everything else in the API verifies
 * that session token instead of talking to Google again.
 */
router.post('/session', async (req, res: Response) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing or malformed Authorization header. Expected: Bearer <Google_Token>',
    });
    return;
  }

  const googleToken = authHeader.split('Bearer ')[1].trim();

  try {
    const user = await verifyGoogleToken(googleToken);

    // role is display/UX only from here on (e.g. showing the Admin entry
    // point) - the JWT itself never carries it, and every admin API call
    // re-reads the role fresh from Firestore regardless of this response.
    let role: 'user' | 'admin' = 'user';
    try {
      const registered = await UserRegistryService.registerOrUpdateUser(user);
      role = registered.role ?? 'user';
    } catch (error) {
      console.error('[Auth Route] Failed to record user in registry:', error);
    }

    const sessionToken = mintAppSessionToken(user);
    res.json({ sessionToken, user: { ...user, role } });
  } catch (error) {
    console.error('[Auth Route] Google token verification failed:', error);
    res.status(403).json({
      error: 'Forbidden',
      message: 'Failed to verify Google token: ' + (error as Error).message,
    });
  }
});

export default router;
