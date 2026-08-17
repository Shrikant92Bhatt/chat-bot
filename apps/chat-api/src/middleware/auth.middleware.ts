import { Request, Response, NextFunction } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { UserRegistryService } from '../services/user-registry.service';
import { AnonUsageService } from '../services/anon-usage.service';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

export interface AuthenticatedRequest extends Request {
  user?: {
    uid: string;
    email?: string;
    name?: string;
    picture?: string;
  };
}

interface VerifiedPayload {
  sub: string;
  email?: string;
  name?: string;
  picture?: string;
}

/**
 * Verifies a Google OAuth2 access token (opaque, non-JWT) via Google's
 * tokeninfo endpoint. This is the token type issued by the client-side
 * `initTokenClient` fallback when Google's One Tap ID-token prompt is
 * skipped/blocked, so the backend must accept it too or every user routed
 * through that fallback gets rejected on their very first request.
 */
async function verifyAccessToken(accessToken: string): Promise<VerifiedPayload> {
  const res = await fetch(
    `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
  );

  if (!res.ok) {
    throw new Error('Access token rejected by Google tokeninfo endpoint.');
  }

  const info = await res.json();

  if (GOOGLE_CLIENT_ID && info.aud !== GOOGLE_CLIENT_ID) {
    throw new Error('Access token audience does not match GOOGLE_CLIENT_ID.');
  }

  if (!info.sub) {
    throw new Error('Access token has no subject claim.');
  }

  return { sub: info.sub, email: info.email };
}

/**
 * Enterprise Production Middleware for Google OAuth 2.0 Token Verification.
 * Accepts either a signed Google ID token (JWT) or a Google OAuth2 access
 * token, since the frontend can issue either depending on which sign-in
 * path it takes.
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
      message: 'Missing or malformed Authorization header. Expected: Bearer <Google_ID_Token>',
    });
    return;
  }

  const idToken = authHeader.split('Bearer ')[1].trim();

  if (!GOOGLE_CLIENT_ID) {
    console.warn('[Google Auth Middleware] GOOGLE_CLIENT_ID environment variable is not set.');
  }

  let payload: VerifiedPayload | undefined;
  let idTokenError: unknown;

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID || undefined,
    });
    payload = ticket.getPayload() ?? undefined;
  } catch (error) {
    idTokenError = error;
  }

  if (!payload) {
    try {
      payload = await verifyAccessToken(idToken);
    } catch (accessTokenError) {
      console.error(
        '[Google Auth Middleware] Token verification failed as both ID token and access token:',
        idTokenError,
        accessTokenError
      );
      const errMsg = (idTokenError as Error)?.message || '';
      if (errMsg.includes('Token used too late') || errMsg.includes('expired')) {
        res.status(401).json({
          error: 'TokenExpired',
          message: 'Your Google Sign-In session has expired. Please click "Sign in with Google" to refresh your session.',
        });
        return;
      }
      res.status(403).json({
        error: 'Forbidden',
        message: 'Failed to verify Google token: ' + errMsg,
      });
      return;
    }
  }

  const authenticatedUser = {
    uid: payload.sub,
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
  };

  req.user = authenticatedUser;
  await UserRegistryService.registerOrUpdateUser(authenticatedUser);

  next();
}

/**
 * Allows one anonymous message per IP (tracked server-side so it survives a
 * page reload or cleared browser storage), then requires Google Sign-In.
 * A valid Bearer token always bypasses the trial limit.
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

  if (!AnonUsageService.hasFreeMessagesRemaining(ip)) {
    res.status(401).json({
      error: 'SignInRequired',
      message: 'Free trial limit reached (1 message without sign-in). Please sign in with Google to continue chatting.',
    });
    return;
  }

  AnonUsageService.recordUsage(ip);
  next();
}
