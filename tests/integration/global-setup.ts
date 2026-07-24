import './setup-env.js';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

/**
 * One-time integration setup: migrate an empty (or existing) PostgreSQL from the
 * generated SQL migrations and import the canonical fixtures. Both steps are
 * idempotent, so re-runs are safe. Proves real PostgreSQL, not a mock.
 */
export default async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL!;
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: join(root, 'db', 'migrations') });
  } finally {
    await pool.end();
  }

  // Import canonical content using the real importer.
  const { db, closePool } = await import('../../apps/api/src/db/index.js');
  const { importCanonicalContent } = await import('../../apps/api/src/modules/content/importer.js');
  const { problems } = await import('../../apps/api/src/db/schema/product.js');
  const { like } = await import('drizzle-orm');
  await importCanonicalContent(db);
  // Retire any leftover historical-pinning fixtures from prior failed runs.
  await db
    .update(problems)
    .set({ status: 'RETIRED' })
    .where(like(problems.problemKey, 'EX-PIN-HIST%'));
  await closePool();
}
