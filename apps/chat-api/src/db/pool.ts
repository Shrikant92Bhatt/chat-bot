import { Pool, PoolConfig } from 'pg';
import { SCHEMA_SQL } from './schema';

// pg has no default connect timeout (0 = wait forever), so a DB that's
// unreachable but not actively refusing connections (e.g. a firewalled
// host, or Cloud SQL not actually wired up on the deployed service) would
// otherwise hang every request until the proxy in front of it times out -
// exactly the "Service Unavailable" failure mode this is guarding against.
const CONNECTION_TIMEOUT_MS = 5000;

function buildPoolConfig(): PoolConfig {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: CONNECTION_TIMEOUT_MS };
  }

  // Cloud Run + Cloud SQL Auth Proxy sidecar: connect over the mounted
  // unix socket instead of a host/port pair.
  if (process.env.INSTANCE_CONNECTION_NAME) {
    return {
      host: `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    };
  }

  return {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'nexusai',
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  };
}

export const pool = new Pool(buildPoolConfig());

export async function runMigrations(): Promise<void> {
  await pool.query(SCHEMA_SQL);
}
