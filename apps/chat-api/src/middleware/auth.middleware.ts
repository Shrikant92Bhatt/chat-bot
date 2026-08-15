import { Request, Response, NextFunction } from 'express';
import * as admin from 'firebase-admin';

// Initialize Firebase Admin SDK if service account environment variables are present
if (!admin.apps.length) {
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log('[Auth] Firebase Admin initialized with service account.');
    } else {
      admin.initializeApp();
      console.log('[Auth] Firebase Admin initialized with default credentials.');
    }
  } catch (error) {
    console.warn('[Auth] Firebase Admin initialization notice:', (error as Error).message);
  }
}

export interface AuthenticatedRequest extends Request {
  user?: admin.auth.DecodedIdToken | { uid: string; email: string; name: string };
}

export async function authenticateToken(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // If dev mode bypass enabled, allow unauthenticated access for testing
    if (process.env.NODE_ENV === 'development' || process.env.SKIP_AUTH === 'true') {
      req.user = {
        uid: 'dev-user-123',
        email: 'dev@example.com',
        name: 'Developer User',
      };
      return next();
    }

    res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing or invalid Authorization header. Expected: Bearer <Firebase_ID_Token>',
    });
    return;
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    if (admin.apps.length && process.env.SKIP_AUTH !== 'true') {
      const decodedToken = await admin.auth().verifyIdToken(idToken);
      req.user = decodedToken;
    } else {
      // Mock validation when firebase app is running locally without full GCP credentials
      req.user = {
        uid: 'user-' + idToken.substring(0, 8),
        email: 'user@example.com',
        name: 'Authenticated User',
      };
    }
    next();
  } catch (error) {
    console.error('[Auth Middleware] Token verification failed:', error);
    res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid or expired Firebase ID token.',
    });
  }
}
