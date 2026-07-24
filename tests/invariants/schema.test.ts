import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { closePool, db } from '../../apps/api/src/db/index.js';

afterAll(async () => {
  await closePool();
});

const EXPECTED_TABLES = [
  'auth_users',
  'auth_sessions',
  'auth_accounts',
  'auth_verifications',
  'user_profiles',
  'programs',
  'problems',
  'chunks',
  'misconception_classes',
  'rollback_rules',
  'learning_sessions',
  'stage_attempts',
  'learning_events',
  'rollback_logs',
];

describe('schema invariants (clean migration, AC-053)', () => {
  it('migrated an empty database into the full expected schema', async () => {
    const rows = (await db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    )) as unknown as { rows: Array<{ table_name: string }> };
    const names = new Set(rows.rows.map((r) => r.table_name));
    for (const table of EXPECTED_TABLES) {
      expect(names.has(table), `missing table ${table}`).toBe(true);
    }
  });

  it('enforces the idempotency unique constraint on stage_attempts', async () => {
    const rows = (await db.execute(
      sql`select indexname from pg_indexes where tablename = 'stage_attempts'`,
    )) as unknown as { rows: Array<{ indexname: string }> };
    const names = rows.rows.map((r) => r.indexname);
    expect(names).toContain('stage_attempts_session_client_uq');
  });

  it('enforces at most one ACTIVE learning_session per subject via a partial unique index', async () => {
    const rows = (await db.execute(
      sql`select indexdef from pg_indexes
          where schemaname = 'public'
            and tablename = 'learning_sessions'
            and indexname = 'learning_sessions_one_active_per_subject_uq'`,
    )) as unknown as { rows: Array<{ indexdef: string }> };
    expect(rows.rows).toHaveLength(1);

    const def = rows.rows[0]!.indexdef;
    // Unique, on the right table/column, gated by the right partial predicate —
    // this is the DB-level enforcement that startSession's ON CONFLICT relies on
    // (concurrent session-start race, PRODUCT_BOOK §11.1/§11.3).
    expect(def).toMatch(/CREATE UNIQUE INDEX/i);
    expect(def).toMatch(/ON public\.learning_sessions/i);
    expect(def).toMatch(/\(analytics_subject_id\)/);
    expect(def).toMatch(/WHERE \(status = 'ACTIVE'::text\)/);
  });
});
