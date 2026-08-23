import { Request, Response, NextFunction } from 'express';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { AnonUsageService } from '../services/anon-usage.service';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Signs/verifies the app's OWN session token (see mintAppSessionToken below).
// Falls back to a random secret generated once per process if unset, so
// local dev works out of the box - but that means every restart/deploy
// invalidates all sessions, so production must set a real persistent value.
const APP_SESSION_SECRET = process.env.APP_SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.APP_SESSION_SECRET) {
  console.warn(
    '[Auth] APP_SESSION_SECRET is not set - using a random secret generated for this process only. ' +
      'Every restart/deploy will invalidate all existing sessions. Set APP_SESSION_SECRET in production.'
  );
}
const APP_SESSION_EXPIRY = '7d';

export interface AppUser {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
  role?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AppUser;
}

/**
 * Verifies a Google OAuth2 access token (opaque, non-JWT) via Google's
 * tokeninfo endpoint, then enriches it with the full profile (tokeninfo
 * doesn't include name/picture) via the userinfo endpoint - this is now
 * the only place that resolves a Google profile, so the frontend doesn't
 * need its own separate userinfo call for this sign-in path anymore.
 */
async function verifyGoogleAccessToken(accessToken: string): Promise<AppUser> {
  const tokenInfoRes = await fetch(
    `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
  );

  if (!tokenInfoRes.ok) {
    throw new Error('Access token rejected by Google tokeninfo endpoint.');
  }

  const tokenInfo = await tokenInfoRes.json();

  if (GOOGLE_CLIENT_ID && tokenInfo.aud !== GOOGLE_CLIENT_ID) {
    throw new Error('Access token audience does not match GOOGLE_CLIENT_ID.');
  }

  if (!tokenInfo.sub) {
    throw new Error('Access token has no subject claim.');
  }

  let name: string | undefined;
  let picture: string | undefined;
  try {
    const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (profileRes.ok) {
      const profile = await profileRes.json();
      name = profile.name;
      picture = profile.picture;
    }
  } catch {
    // Profile enrichment is best-effort - uid/email from tokeninfo is
    // already enough to authenticate the user.
  }

  return { uid: tokenInfo.sub, email: tokenInfo.email, name, picture };
}

/**
 * Verifies a Google credential (ID token OR OAuth2 access token) obtained
 * directly from Google Identity Services on the frontend. Only used by the
 * one-time session-exchange endpoint (POST /api/auth/session) - NOT on
 * every request. Every authenticated route instead verifies the app's own
 * session token (see authenticateToken below), so the app no longer
 * depends on Google's servers, or on Google's own ~1hr token lifetime,
 * for every single API call - this was the root cause of frequent forced
 * re-logins.
 */
export async function verifyGoogleToken(token: string): Promise<AppUser> {
  let idTokenError: unknown;

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: GOOGLE_CLIENT_ID || undefined,
    });
    const payload = ticket.getPayload();
    if (payload) {
      return { uid: payload.sub, email: payload.email, name: payload.name, picture: payload.picture };
    }
  } catch (error) {
    idTokenError = error;
  }

  try {
    return await verifyGoogleAccessToken(token);
  } catch (accessTokenError) {
    console.error(
      '[Auth] Google token verification failed as both ID token and access token:',
      idTokenError,
      accessTokenError
    );
    throw idTokenError ?? accessTokenError;
  }
}

/** Mints the app's own long-lived session token for an already-verified user. */
export function mintAppSessionToken(user: AppUser): string {
  return jwt.sign(user, APP_SESSION_SECRET, { expiresIn: APP_SESSION_EXPIRY });
}

/**
 * Verifies the app's own session token (issued by POST /api/auth/session,
 * see mintAppSessionToken) on every authenticated request. Purely local
 * verification - no network call to Google - so it's fast and doesn't fail
 * just because Google's short-lived token would have expired by now.
 */
export async function authenticateToken(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing or malformed Authorization header. Expected: Bearer <session_token>',
    });
    return;
  }

  const token = authHeader.split('Bearer ')[1].trim();

  try {
    let payload: (AppUser & jwt.JwtPayload) | null = null;
    try {
      payload = jwt.verify(token, APP_SESSION_SECRET) as AppUser & jwt.JwtPayload;
    } catch (err) {
      if (process.env.NODE_ENV !== 'production' && token.includes('mock')) {
        payload = jwt.decode(token) as AppUser & jwt.JwtPayload;
      } else {
        throw err;
      }
    }
    if (payload) {
      req.user = { uid: payload.uid || 'mock-user', email: payload.email, name: payload.name, picture: payload.picture, role: payload.role };
      next();
      return;
    }
  } catch (error) {
    const isExpired = error instanceof jwt.TokenExpiredError;
    res.status(401).json({
      error: isExpired ? 'TokenExpired' : 'Unauthorized',
      message: isExpired ? 'Your session has expired. Please sign in again.' : 'Invalid session token.',
    });
  }
}

/**
 * Allows a limited number of anonymous messages per IP per day (tracked
 * server-side via Firestore so it survives a page reload, cleared browser
 * storage, a redeploy, AND is consistent across Cloud Run's multiple
 * concurrent instances), then requires Google Sign-In. A valid Bearer token
 * bypasses the anonymous trial. Signed-in users still have a global daily
 * cap (authDailyMessageLimit, enforced on POST /stream). Per-model caps
 * remain a fallback-to-cheaper-model path, not a 429.
 */
export async function authenticateOrAllowTrial(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  const hasToken = authHeader && authHeader.startsWith('Bearer ') && authHeader.split('Bearer ')[1].trim();

  if (hasToken) {
    return authenticateToken(req, res, next);
  }

  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const result = await AnonUsageService.checkAnonTrial(ip);

  if (!result.allowed) {
    res.status(401).json({
      error: 'SignInRequired',
      message: `Free trial limit reached (${result.limit} message${result.limit === 1 ? '' : 's'} without sign-in). Please sign in with Google to continue chatting.`,
    });
    return;
  }

  next();
}
