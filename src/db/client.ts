import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

const { Pool } = pg;

const isSupabase =
  (env.DATABASE_URL && env.DATABASE_URL.includes('supabase')) ||
  (env.POSTGRES_HOST && env.POSTGRES_HOST.includes('supabase')) ||
  env.POSTGRES_SSL;

const poolConfig: pg.PoolConfig = env.DATABASE_URL
  ? {
      connectionString: env.DATABASE_URL,
      ssl: isSupabase ? { rejectUnauthorized: false } : undefined,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    }
  : {
      host: env.POSTGRES_HOST,
      port: env.POSTGRES_PORT,
      database: env.POSTGRES_DB,
      user: env.POSTGRES_USER,
      password: env.POSTGRES_PASSWORD,
      ssl: isSupabase ? { rejectUnauthorized: false } : undefined,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      // Supabase Transaction Pooler (port 6543) không hỗ trợ startup options
      ...(env.POSTGRES_PORT !== 6543 && !env.DATABASE_URL?.includes(':6543')
        ? { options: '-c timezone=UTC' }
        : {}),
    };

export const db = new Pool(poolConfig);

db.on('error', (err) => {
  logger.error({ err }, 'PostgreSQL pool error');
});

export async function query<T extends pg.QueryResultRow>(
  sql: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return db.query<T>(sql, params);
}

export async function withTransaction<T>(
  callback: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function checkDbConnection(): Promise<boolean> {
  try {
    await db.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
