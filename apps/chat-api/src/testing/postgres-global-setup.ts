/**
 * Vitest `globalSetup` - runs once in a plain Node context before any test
 * file starts (not inside a worker, no mocks active), so this is the right
 * place to apply pending migrations exactly once per test run rather than
 * racing N test files that each try it.
 *
 * Needs a real Postgres reachable at DATABASE_URL - see README.md's "Local
 * development" section for how to start one. This replaces the old
 * fake-firestore.ts in-memory mock: that worked because Firestore's API
 * surface used here was small enough to hand-roll, but there's no
 * equivalent shortcut for real SQL without either a second SQL engine
 * dependency or a real risk of the fake and the real database silently
 * drifting apart. Running tests against the actual engine catches real
 * bugs (see this migration's own history - a param-index bug in
 * analytics.service.ts's getUsageRecords only surfaced once a smoke test
 * ran real queries, not during a plain typecheck).
 */
export default async function setup() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not set. Tests need a real Postgres database - see README.md\'s ' +
        '"Local development" section for how to start one, e.g.:\n' +
        '  docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16\n' +
        '  export DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres'
    );
  }

  const { runMigrations, pool } = await import('../db/postgres');
  await runMigrations();
  await pool.end();
}
