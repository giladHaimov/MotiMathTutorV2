import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

/** Migrate + seed the real database before the browser suite runs. */
export default async function globalSetup(): Promise<void> {
  const url =
    process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5439/reasoning_tutor';
  process.env.DATABASE_URL = url;
  process.env.BETTER_AUTH_SECRET ??= 'e2e-test-secret-please-change-32chars';
  process.env.BETTER_AUTH_URL ??= 'http://localhost:8080';

  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: join(root, 'db', 'migrations') });
  } finally {
    await pool.end();
  }

  const { db, closePool } = await import('../../apps/api/src/db/index.js');
  const { importCanonicalContent } = await import('../../apps/api/src/modules/content/importer.js');
  await importCanonicalContent(db);
  await closePool();
}
