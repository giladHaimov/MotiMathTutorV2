import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

/**
 * Explicit migration runner (ARCHITECTURE §16): applies the generated SQL
 * migrations from db/migrations against the configured PostgreSQL. Run as a
 * deliberate deploy/release step, never implicitly by every replica.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required to run migrations');
  }
  const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);
  try {
    console.log('Running migrations from', migrationsFolder);
    await migrate(db, { migrationsFolder });
    console.log('Migrations complete.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
