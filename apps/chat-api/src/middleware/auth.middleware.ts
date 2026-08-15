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

/**
 * Enterprise Production Middleware for Google OAuth 2.0 Token Verification.
 * Validates incoming Bearer ID tokens against Google's public key infrastructure.
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

  try {
    if (!GOOGLE_CLIENT_ID) {
      console.warn('[Google Auth Middleware] GOOGLE_CLIENT_ID environment variable is not set.');
    }

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: GOOGLE_CLIENT_ID || undefined,
    });
    const payload = ticket.getPayload();

    if (!payload) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Invalid Google ID Token payload.',
      });
      return;
    }

    const authenticatedUser = {
      uid: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture,
    };

    req.user = authenticatedUser;
    UserRegistryService.registerOrUpdateUser(authenticatedUser);

    next();
  } catch (error) {
    console.error('[Google Auth Middleware] Token verification failed:', error);
    const errMsg = (error as Error).message || '';
    if (errMsg.includes('Token used too late') || errMsg.includes('expired')) {
      res.status(401).json({
        error: 'TokenExpired',
        message: 'Your Google Sign-In session has expired. Please click "Sign in with Google" to refresh your session.',
      });
      return;
    }
    res.status(403).json({
      error: 'Forbidden',
      message: 'Failed to verify Google ID Token: ' + errMsg,
    });
  }
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
