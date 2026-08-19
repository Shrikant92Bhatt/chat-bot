import '../env'; // loads .env before firestore.ts reads GOOGLE_APPLICATION_CREDENTIALS etc.
import { firestore } from '../db/firestore';

/**
 * One-time backfill: adds a `role` field ('user' | 'admin') to every
 * existing users/{uid} document that doesn't already have one. Idempotent -
 * safe to re-run; only touches docs missing `role`, never overwrites an
 * existing role (so a later manual promotion/demotion via the admin API is
 * never clobbered by re-running this).
 *
 * The admin allowlist is intentionally hardcoded here rather than passed as
 * a CLI arg - this is a one-time bootstrap for the very first admin(s), not
 * a recurring operation. Ongoing promotion/demotion goes through
 * PATCH /api/v1/admin/users/:uid/role instead (see admin.routes.ts), which
 * requires an existing admin to already be signed in - this script is what
 * gets you that first admin.
 *
 * Run with: npx ts-node apps/chat-api/src/scripts/migrate-add-user-roles.ts
 * (or compile via `nx build chat-api` and run the .js output with node).
 */
const INITIAL_ADMIN_EMAILS = ['shrikantbhatt92@gmail.com'];

async function main() {
  const snapshot = await firestore.collection('users').get();
  console.log(`Found ${snapshot.size} user document(s).`);

  let promoted = 0;
  let backfilledAsUser = 0;
  let alreadyHadRole = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data() as { email?: string; role?: string };
    if (data.role) {
      alreadyHadRole++;
      continue;
    }

    const role = data.email && INITIAL_ADMIN_EMAILS.includes(data.email) ? 'admin' : 'user';
    await doc.ref.set({ role }, { merge: true });

    if (role === 'admin') {
      promoted++;
      console.log(`  -> ${data.email ?? doc.id}: admin`);
    } else {
      backfilledAsUser++;
    }
  }

  console.log(
    `Done. ${promoted} promoted to admin, ${backfilledAsUser} backfilled as user, ${alreadyHadRole} already had a role (untouched).`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[migrate-add-user-roles] Failed:', error);
    process.exit(1);
  });
