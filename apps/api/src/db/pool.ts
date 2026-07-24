import pg from 'pg';
import { getConfig } from '../config/index.js';

/**
 * Single shared node-postgres pool. Durable product state lives in real
 * PostgreSQL — there is no in-memory fallback (PB-027).
 */
let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: getConfig().DATABASE_URL, max: 10 });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
