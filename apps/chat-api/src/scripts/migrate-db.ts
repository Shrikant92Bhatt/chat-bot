import '../env'; // must be first - loads .env before db/postgres.ts reads DATABASE_URL
import { runMigrations, pool } from '../db/postgres';

/**
 * Applies every pending migration in db/migrations (see runMigrations' doc
 * comment for why this is a separate script rather than something
 * db/postgres.ts runs on its own module load). Run once per environment
 * after DATABASE_URL is set - locally, in CI before tests, and once against
 * production before the first deploy that depends on these tables.
 *
 * Run with: npx ts-node apps/chat-api/src/scripts/migrate-db.ts
 * (or compile via `nx build chat-api` and run the .js output with node).
 */
async function main() {
  await runMigrations();
  console.log('[migrate-db] All migrations applied.');
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[migrate-db] Failed:', error);
    process.exit(1);
  });
