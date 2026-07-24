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

/**
 * Pre-flight guard for migration 0001 (`learning_sessions_one_active_per_subject_uq`).
 *
 * Assumption (documented, pre-release project): no production data exists yet,
 * so no duplicate ACTIVE learning_sessions rows are expected. This check proves
 * that assumption rather than trusting it — it never deletes or modifies rows.
 * If duplicates are ever found (e.g. this migration is applied late against a
 * database that already hit the concurrent-start race), the migration is
 * refused with a diagnostic listing every affected analytics_subject_id so a
 * human can decide the reconciliation (which duplicate session to keep) rather
 * than the migration silently picking one.
 */
async function assertNoDuplicateActiveSessions(pool: pg.Pool): Promise<void> {
  let rows: Array<{ analytics_subject_id: string; active_count: string }>;
  try {
    const result = await pool.query<{ analytics_subject_id: string; active_count: string }>(
      `select analytics_subject_id, count(*)::text as active_count
       from learning_sessions
       where status = 'ACTIVE'
       group by analytics_subject_id
       having count(*) > 1
       order by analytics_subject_id`,
    );
    rows = result.rows;
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === '42P01') {
      // learning_sessions does not exist yet (fresh database, 0000_init pending) — nothing to check.
      return;
    }
    throw err;
  }

  if (rows.length === 0) return;

  const subjects = rows.map((r) => `${r.analytics_subject_id} (${r.active_count} ACTIVE rows)`);
  throw new Error(
    'Refusing to run migrations: learning_sessions_one_active_per_subject_uq would fail ' +
      'because duplicate ACTIVE sessions already exist for the following analytics_subject_id(s):\n' +
      subjects.map((s) => `  - ${s}`).join('\n') +
      '\nNo rows were changed. Reconcile manually (decide which ACTIVE session per subject ' +
      'survives, mark the others ABANDONED with completed_at left null per the status check ' +
      'constraint) and re-run migrations. This project is pre-release, so this condition is not ' +
      'expected in practice; it is enforced here rather than assumed.',
  );
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required to run migrations');
  }
  const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), 'migrations');
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);
  try {
    await assertNoDuplicateActiveSessions(pool);
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
