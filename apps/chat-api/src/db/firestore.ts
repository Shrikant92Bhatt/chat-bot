import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

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

// Database ID, not "(default)" - admin.firestore() only ever targets the
// database literally named "(default)", so a non-default database (e.g.
// "nexus-ai") must be selected explicitly via getFirestore(app, databaseId).
const databaseId = process.env.FIRESTORE_DATABASE_ID || '(default)';
export const firestore = getFirestore(admin.app(), databaseId);
