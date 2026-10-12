import { Pool, PoolClient, types } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

// `pg` returns BIGINT (OID 20) columns as JS strings by default, to avoid
// silently losing precision above Number.MAX_SAFE_INTEGER. Every BIGINT
// column in this schema is an epoch-millisecond timestamp or a request
// count - both are safe integers for a very long time (epoch-ms won't
// exceed MAX_SAFE_INTEGER until the year 287396), and every service here
// was written against Firestore's plain `number` fields, so parsing these
// back to numbers (rather than threading string-vs-number conversions
// through every call site) is what keeps this a faithful port.
types.setTypeParser(20, (value: string) => parseInt(value, 10));

/**
 * Postgres connection pool - replaces db/firestore.ts (see VERCEL_MIGRATION.md
 * for why: Vercel serverless functions have no equivalent to Cloud Run's
 * Application Default Credentials, so every deploy needed a manually
 * generated GCP service-account key just to reach Firestore. A real
 * Postgres database (Neon, provisioned through Vercel's own Storage tab,
 * or any Postgres-compatible host) needs only a connection string.
 *
 * ── Serverless connection limits (read before changing `max`) ────────────
 * Each warm Vercel function instance is a separate OS process with its own
 * pool - under concurrent traffic, total DB connections = (concurrent warm
 * instances) x (this pool's `max`), NOT a single shared pool across the
 * whole app. Keeping `max` small here only bounds the per-instance side of
 * that; the other half is using a connection-pooled (PgBouncer-backed)
 * connection string from the provider - Neon's dashboard calls this the
 * "pooled" connection string (hostname ends in `-pooler`) - so many
 * concurrent serverless instances can multiplex onto a small number of real
 * Postgres backend connections instead of each holding one open. Use the
 * pooled string for DATABASE_URL in production; the plain one is fine for
 * local dev (one process, no concurrency to worry about).
 */

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn('[Postgres] DATABASE_URL is not set - every query against it will fail until it is.');
}

function needsSsl(url: string | undefined): boolean {
  if (!url) return false;
  // Managed providers (Neon, Supabase, RDS, etc.) require TLS; a bare local
  // `postgres://` URL (this app's own dev/test Postgres, no sslmode param)
  // does not speak TLS at all, so forcing `ssl` there would just fail every
  // connection outright.
  return /sslmode=require/.test(url) || /\.neon\.tech|\.supabase\.co|\.rds\.amazonaws\.com/.test(url);
}

export const pool = new Pool({
  connectionString,
  ssl: needsSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.PG_POOL_MAX) || 5,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (error) => {
  // A broken idle connection must not crash the whole process - the next
  // query against the pool opens a fresh one. Mirrors how firestore.ts
  // never needed this (the Admin SDK handles reconnects internally); `pg`
  // surfaces it as an event instead, so it has to be handled explicitly.
  console.error('[Postgres] Idle client error:', error);
});

export type QueryParam = string | number | boolean | null | undefined;

/** Thin wrapper so call sites don't import `pg` types directly - same
 *  "one place owns the client" shape db/firestore.ts had. */
export async function query<T = Record<string, unknown>>(text: string, params?: QueryParam[]): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

/**
 * Runs a callback inside a single checked-out client, for call sites that
 * need more than one statement to see a consistent view (row locking,
 * multi-statement transactions) - see anon-usage.service.ts's atomic
 * check-and-increment for the main use. Always releases the client, and
 * rolls back on any thrown error so a failed transaction never leaves a
 * half-applied write behind.
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Applies every .sql file in db/migrations in filename order, tracking which
 * ones have already run in a `_migrations` table so this is safe to call on
 * every test-suite boot and from a one-time deploy script alike - never
 * re-applies a migration, and a migration that's all `CREATE ... IF NOT
 * EXISTS` (as 001_init.sql is) is additionally safe to re-run by hand.
 * Deliberately NOT called automatically from postgres.ts's own module load:
 * running DDL on every cold start of every serverless instance would race
 * against itself under concurrent cold starts. Call it explicitly from a
 * deploy step or test setup instead.
 */
export async function runMigrations(): Promise<void> {
  await pool.query('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at BIGINT NOT NULL)');

  const applied = new Set((await query<{ name: string }>('SELECT name FROM _migrations')).map((r) => r.name));
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query('INSERT INTO _migrations (name, applied_at) VALUES ($1, $2)', [file, Date.now()]);
    });
    console.log(`[Postgres] Applied migration ${file}`);
  }
}
