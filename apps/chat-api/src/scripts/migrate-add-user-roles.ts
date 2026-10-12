import '../env'; // loads .env before db/postgres.ts reads DATABASE_URL
import { query, pool } from '../db/postgres';

/**
 * One-time bootstrap: promotes the hardcoded allowlisted email(s) to admin.
 * Idempotent - safe to re-run; only promotes rows that aren't already
 * admin, never demotes one that already is.
 *
 * Pre-Postgres, this also had to backfill a `role` column onto every
 * existing user document that predated the field entirely (Firestore has
 * no schema, so old docs could simply be missing it). The `users` table's
 * `role` column now has `NOT NULL DEFAULT 'user'` from the moment it's
 * created (see db/migrations/001_init.sql), so that backfill no longer
 * applies to any row written from here on - this script's only remaining
 * job is the first-admin bootstrap below.
 *
 * The admin allowlist is intentionally hardcoded here rather than passed as
 * a CLI arg - this is a one-time bootstrap for the very first admin(s), not
 * a recurring operation. Ongoing promotion/demotion goes through
 * PATCH /api/v1/admin/users/:uid/role instead (see admin.routes.ts), which
 * requires an existing admin to already be signed in - this script is what
 * gets you that first admin.
 *
 * Run with: npx ts-node -r tsconfig-paths/register apps/chat-api/src/scripts/migrate-add-user-roles.ts
 * (or compile via `nx build chat-api` and run the .js output with node).
 */
const INITIAL_ADMIN_EMAILS = ['shrikantbhatt92@gmail.com'];

async function main() {
  const rows = await query<{ uid: string; email: string | null; role: string }>('SELECT uid, email, role FROM users');
  console.log(`Found ${rows.length} user row(s).`);

  let promoted = 0;
  let alreadyAdmin = 0;

  for (const row of rows) {
    if (row.role === 'admin') {
      alreadyAdmin++;
      continue;
    }
    if (!row.email || !INITIAL_ADMIN_EMAILS.includes(row.email)) continue;

    await query("UPDATE users SET role = 'admin' WHERE uid = $1", [row.uid]);
    promoted++;
    console.log(`  -> ${row.email}: admin`);
  }

  console.log(`Done. ${promoted} promoted to admin, ${alreadyAdmin} already admin.`);

  if (promoted === 0 && alreadyAdmin === 0) {
    console.log(
      'No matching user row found yet for the allowlisted email(s) - sign in with that Google account at least ' +
        'once first (which creates the row via UserRegistryService.registerOrUpdateUser), then re-run this script.'
    );
  }
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[migrate-add-user-roles] Failed:', error);
    process.exit(1);
  });
