/**
 * PostgreSQL connection pool [10-backend.md]
 * Dùng pg Pool, không hardcode credentials
 */
import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

const { Pool } = pg;

// Nhận diện kết nối Supabase (yêu cầu SSL) hoặc khi có cờ POSTGRES_SSL
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

// Log connection errors
db.on('error', (err) => {
  logger.error({ err }, 'PostgreSQL pool error');
});

/**
 * Helper: run query với parameterized values (tránh SQL injection)
 * Luôn dùng hàm này, không tự concatenate SQL string [10-backend.md]
 */
export async function query<T extends pg.QueryResultRow>(
  sql: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return db.query<T>(sql, params);
}

/**
 * Helper: transaction wrapper
 * Chạy callback trong 1 transaction, auto rollback nếu có lỗi
 */
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

/**
 * Health check — dùng cho /health endpoint
 */
export async function checkDbConnection(): Promise<boolean> {
  try {
    await db.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
