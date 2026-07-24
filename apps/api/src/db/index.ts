import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { getPool } from './pool.js';
import * as schema from './schema/index.js';

export type Db = NodePgDatabase<typeof schema>;

// Lazily bind Drizzle to the CURRENT pool. If the pool is closed and recreated
// (e.g. between test files, or on reconnect), the next access rebuilds cleanly.
let cachedDb: Db | null = null;
let cachedPool: pg.Pool | null = null;

function getDb(): Db {
  const pool = getPool();
  if (!cachedDb || cachedPool !== pool) {
    cachedDb = drizzle(pool, { schema });
    cachedPool = pool;
  }
  return cachedDb;
}

/** Typed Drizzle instance over the shared pool, used for all product queries. */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(real)
      : value;
  },
});

export { schema };
export * from './schema/index.js';
export { getPool, closePool } from './pool.js';
