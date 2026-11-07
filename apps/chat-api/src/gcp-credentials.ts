/**
 * Explicit GCP credentials from FIREBASE_SERVICE_ACCOUNT_KEY (a service-account
 * JSON key stored as one env var). Vercel has no built-in GCP identity, so
 * Firestore AND Cloud Storage both need this there. Returns undefined when the
 * var is unset, letting the clients fall back to Application Default
 * Credentials (Cloud Run's own identity, or GOOGLE_APPLICATION_CREDENTIALS locally).
 */
export interface GcpServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  [key: string]: unknown;
}

let cached: GcpServiceAccount | undefined | null = null;

export function getServiceAccount(): GcpServiceAccount | undefined {
  if (cached !== null) return cached;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim();
  if (!raw) {
    cached = undefined;
    return cached;
  }

  try {
    const parsed = JSON.parse(raw) as GcpServiceAccount;
    // A key pasted as one line sometimes keeps "\n" as two literal characters
    // inside private_key, which makes the PEM unreadable.
    if (typeof parsed.private_key === 'string') {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    }
    cached = parsed;
  } catch (error) {
    console.error(
      '[GCP] FIREBASE_SERVICE_ACCOUNT_KEY is set but is not valid JSON - paste the whole downloaded key file, from { to }.',
      (error as Error).message
    );
    cached = undefined;
  }
  return cached;
}

/** Options for `new Storage(...)`: explicit key when available, otherwise ADC. */
export function storageClientOptions(): { projectId?: string; credentials?: { client_email: string; private_key: string } } {
  const sa = getServiceAccount();
  if (!sa) return {};
  return {
    projectId: sa.project_id,
    credentials: { client_email: sa.client_email, private_key: sa.private_key },
  };
}
