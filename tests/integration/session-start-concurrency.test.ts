import { afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';
import { makeApp, registerUser, newUuid, type TestUser } from '../helpers/app.js';
import { closePool, db, schema } from '../../apps/api/src/db/index.js';
import { learningSessions } from '../../apps/api/src/db/schema/product.js';
import { startSession } from '../../apps/api/src/modules/sessions/service.js';
import type { Profile } from '../../apps/api/src/modules/profile/service.js';
import type { ActionType, PublicSession } from '@app/contracts';

let app: FastifyInstance;

afterAll(async () => {
  await app?.close();
  await closePool();
});

function authed(user: TestUser, opts: Parameters<FastifyInstance['inject']>[0]) {
  const o = typeof opts === 'string' ? { url: opts } : opts;
  return app.inject({ ...o, headers: { cookie: user.cookie, ...(o.headers ?? {}) } });
}

async function activeCount(subjectId: string): Promise<number> {
  const rows = await db
    .select({ id: learningSessions.id })
    .from(learningSessions)
    .where(
      and(
        eq(learningSessions.analyticsSubjectId, subjectId),
        eq(learningSessions.status, 'ACTIVE'),
      ),
    );
  return rows.length;
}

async function subjectIdFor(user: TestUser): Promise<string> {
  const res = await authed(user, { method: 'GET', url: '/api/me' });
  return (res.json() as { analytics_subject_id: string }).analytics_subject_id;
}

async function act(
  user: TestUser,
  session: PublicSession,
  action_type: ActionType,
  payload: Record<string, unknown>,
): Promise<PublicSession> {
  const res = await authed(user, {
    method: 'POST',
    url: `/api/sessions/${session.session_id}/actions`,
    payload: {
      client_action_id: newUuid(),
      expected_state_version: session.state_version,
      action_type,
      payload,
    },
  });
  return res.json() as PublicSession;
}

/** Complete EX-01 end to end (mirrors tests/integration/ex01-journey.test.ts). */
async function completeEx01(user: TestUser, session: PublicSession): Promise<PublicSession> {
  let s = session;
  s = await act(user, s, 'ASSIGN_SLOT', { slot: 'WHOLE', token_id: 'ex01-c0-whole' });
  s = await act(user, s, 'SUBMIT_COMMITMENT', {});
  s = await act(user, s, 'ASSIGN_SLOT', {
    slot: 'PART_IN_PERCENTAGE',
    token_id: 'ex01-c1-percent',
  });
  s = await act(user, s, 'SUBMIT_COMMITMENT', {});
  s = await act(user, s, 'ASSIGN_SLOT', { slot: 'UNKNOWN', token_id: 'ex01-c2-unknown' });
  s = await act(user, s, 'SUBMIT_FINAL_ANSWER', { value: '12' });
  return s;
}

describe('concurrent session start (fix/session-start-concurrency)', () => {
  it('A. two concurrent POST /api/sessions converge on one session_id and one ACTIVE row', async () => {
    app = app ?? (await makeApp());
    const user = await registerUser(app);
    const subjectId = await subjectIdFor(user);

    const start = () => authed(user, { method: 'POST', url: '/api/sessions' });
    const [a, b] = await Promise.all([start(), start()]);

    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);
    const sa = a.json() as PublicSession;
    const sb = b.json() as PublicSession;
    expect(sa.session_id).toBe(sb.session_id);

    expect(await activeCount(subjectId)).toBe(1);
  });

  it('B. ten-way high-contention start converges on one session_id and one ACTIVE row', async () => {
    app = app ?? (await makeApp());
    const user = await registerUser(app);
    const subjectId = await subjectIdFor(user);

    const start = () => authed(user, { method: 'POST', url: '/api/sessions' });
    const results = await Promise.all(Array.from({ length: 10 }, () => start()));

    for (const r of results) {
      expect(r.statusCode).toBe(201);
    }
    const ids = new Set(results.map((r) => (r.json() as PublicSession).session_id));
    expect(ids.size).toBe(1);

    expect(await activeCount(subjectId)).toBe(1);
  });

  it('C. progression regression: completing the raced session advances to the next problem, not an orphan duplicate', async () => {
    app = app ?? (await makeApp());
    const user = await registerUser(app);
    const subjectId = await subjectIdFor(user);

    const start = () => authed(user, { method: 'POST', url: '/api/sessions' });
    const [a, b, c] = await Promise.all([start(), start(), start()]);
    const raced = [a, b, c].map((r) => r.json() as PublicSession);
    const sessionId = raced[0]!.session_id;
    expect(raced.every((s) => s.session_id === sessionId)).toBe(true);
    // EX-01 is the lowest-difficulty fixture and is deterministically first.
    expect(raced[0]!.visible_chunks[0]!.content).toBe('A class has 40 students.');

    const completed = await completeEx01(user, raced[0]!);
    expect(completed.status).toBe('COMPLETED');

    // No untouched duplicate should exist to be resurrected.
    const completedSessionRow = await db
      .select({ status: learningSessions.status })
      .from(learningSessions)
      .where(eq(learningSessions.id, sessionId));
    expect(completedSessionRow[0]?.status).toBe('COMPLETED');
    expect(await activeCount(subjectId)).toBe(0);

    const next = await authed(user, { method: 'POST', url: '/api/sessions' });
    expect(next.statusCode).toBe(201);
    const nextSession = next.json() as PublicSession;

    // Not the same session, not EX-01 again — authoritative progression moved on.
    expect(nextSession.session_id).not.toBe(sessionId);
    expect(nextSession.visible_chunks[0]!.content).not.toBe('A class has 40 students.');
    expect(nextSession.visible_chunks[0]!.content).toBe(
      'Red and blue marbles are in the ratio 2:3.',
    );

    expect(await activeCount(subjectId)).toBe(1);
  });

  it('D. cross-instance: two independent DB connections racing to start converge on one row', async () => {
    app = app ?? (await makeApp());
    const user = await registerUser(app);
    const subjectId = await subjectIdFor(user);

    const url = process.env.DATABASE_URL!;
    // Two fully independent pools/connections — not the shared app `db` singleton —
    // simulating two separate API instances behind a load balancer. If correctness
    // depended on in-process JS state (a mutex, a cached lookup) rather than the
    // database constraint, this would be able to duplicate the session.
    const poolA = new pg.Pool({ connectionString: url, max: 2 });
    const poolB = new pg.Pool({ connectionString: url, max: 2 });
    try {
      const dbA = drizzle(poolA, { schema });
      const dbB = drizzle(poolB, { schema });
      const profile: Profile = {
        authUserId: 'unused-for-this-direct-service-call',
        analyticsSubjectId: subjectId,
        status: 'ACTIVE',
      };

      const [sessA, sessB] = await Promise.all([
        startSession(dbA, profile, '1.0.0'),
        startSession(dbB, profile, '1.0.0'),
      ]);

      expect(sessA.session_id).toBe(sessB.session_id);
      expect(await activeCount(subjectId)).toBe(1);
    } finally {
      await poolA.end();
      await poolB.end();
    }
  });
});
