import * as admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import { getServiceAccount } from '../gcp-credentials';

if (!admin.apps.length) {
  // FIREBASE_SERVICE_ACCOUNT_KEY: JSON-stringified service-account key,
  // useful where a file path isn't convenient (e.g. pasted directly into a
  // secret manager). Otherwise falls back to Application Default
  // Credentials, which on Cloud Run is the service's own identity (grant
  // it the "Cloud Datastore User" IAM role) or, for local dev, a
  // downloaded key file pointed to by GOOGLE_APPLICATION_CREDENTIALS.
  // See .env.example / DEPLOY_COMMANDS.md.
  const serviceAccount = getServiceAccount();
  if (serviceAccount) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount as admin.ServiceAccount),
      projectId: serviceAccount.project_id,
    });
  } else {
    if (process.env.VERCEL) {
      console.error(
        '[Firestore] FIREBASE_SERVICE_ACCOUNT_KEY is not set. Vercel has no GCP identity, so every database call will fail until it is added.'
      );
    }
    admin.initializeApp();
  }
}

// Database ID, not "(default)" - admin.firestore() only ever targets the
// database literally named "(default)", so a non-default database (e.g.
// "nexus-ai") must be selected explicitly via getFirestore(app, databaseId).
const databaseId = process.env.FIRESTORE_DATABASE_ID || '(default)';
export const firestore = getFirestore(admin.app(), databaseId);
// By default the SDK throws on any `undefined` field value instead of
// dropping it, which is easy to trip over when a document is built by
// spreading a partial DTO (e.g. a ChatMessage with an optional field set
// to `undefined` rather than omitted) - drop the field instead of
// rejecting the whole document.
firestore.settings({ ignoreUndefinedProperties: true });
