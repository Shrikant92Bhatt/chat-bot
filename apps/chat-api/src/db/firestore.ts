import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  // FIREBASE_SERVICE_ACCOUNT_KEY: JSON-stringified service-account key,
  // useful where a file path isn't convenient (e.g. pasted directly into a
  // secret manager). Otherwise falls back to Application Default
  // Credentials, which on Cloud Run is the service's own identity (grant
  // it the "Cloud Datastore User" IAM role) or, for local dev, a
  // downloaded key file pointed to by GOOGLE_APPLICATION_CREDENTIALS.
  // See .env.example / DEPLOY_COMMANDS.md.
  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (serviceAccountKey) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(serviceAccountKey)) });
  } else {
    admin.initializeApp();
  }
}

export const firestore = admin.firestore();
