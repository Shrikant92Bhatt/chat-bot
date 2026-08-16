import { Pool, PoolConfig } from 'pg';
import { SCHEMA_SQL } from './schema';

function buildPoolConfig(): PoolConfig {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }

  // Cloud Run + Cloud SQL Auth Proxy sidecar: connect over the mounted
  // unix socket instead of a host/port pair.
  if (process.env.INSTANCE_CONNECTION_NAME) {
    return {
      host: `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    };
  }

  return {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'nexusai',
  };
}

export const pool = new Pool(buildPoolConfig());

export async function runMigrations(): Promise<void> {
  await pool.query(SCHEMA_SQL);
}
