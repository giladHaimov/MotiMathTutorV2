import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { makeApp, registerUser, newUuid, type TestUser } from '../helpers/app.js';
import { closePool, db } from '../../apps/api/src/db/index.js';
import { userProfiles } from '../../apps/api/src/db/schema/product.js';
import type { PublicSession } from '@app/contracts';

let app: FastifyInstance;
let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  app = await makeApp();
  alice = await registerUser(app);
  bob = await registerUser(app);
});
afterAll(async () => {
  await app.close();
  await closePool();
});

const as = (u: TestUser, o: Parameters<FastifyInstance['inject']>[0]) => {
  const opts = typeof o === 'string' ? { url: o } : o;
  return app.inject({ ...opts, headers: { cookie: u.cookie, ...(opts.headers ?? {}) } });
};

describe('auth and ownership (real Better Auth + PostgreSQL)', () => {
  it('allows anonymous /health but rejects protected routes (AC-002, SCN-01)', async () => {
    expect((await app.inject({ url: '/health' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/dashboard' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/me' })).statusCode).toBe(401);
  });

  it('creates a pseudonymous profile that is not the email (AC-004)', async () => {
    const me = (await as(alice, '/api/me')).json() as { analytics_subject_id: string };
    expect(me.analytics_subject_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(me.analytics_subject_id).not.toContain('@');
    expect((await as(alice, '/api/dashboard')).statusCode).toBe(200);
  });

  it('logout prevents subsequent protected access (AC-003, SCN-01)', async () => {
    const tmp = await registerUser(app);
    expect((await as(tmp, '/api/me')).statusCode).toBe(200);
    await as(tmp, { method: 'POST', url: '/api/auth/sign-out', payload: {} });
    expect((await as(tmp, '/api/me')).statusCode).toBe(401);
  });

  it('a student cannot read or act on another student’s session (AC-005/006, SCN-10)', async () => {
    const session = (
      await as(alice, { method: 'POST', url: '/api/sessions' })
    ).json() as PublicSession;

    const bobRead = await as(bob, `/api/sessions/${session.session_id}`);
    expect(bobRead.statusCode).toBe(404);

    const bobAct = await as(bob, {
      method: 'POST',
      url: `/api/sessions/${session.session_id}/actions`,
      payload: {
        client_action_id: newUuid(),
        expected_state_version: session.state_version,
        action_type: 'ASSIGN_SLOT',
        payload: { slot: 'WHOLE', token_id: session.visible_chunks[0]!.tokens[0]!.token_id },
      },
    });
    expect(bobAct.statusCode).toBe(404);

    // Alice's session is untouched.
    const aliceRead = (
      await as(alice, `/api/sessions/${session.session_id}`)
    ).json() as PublicSession;
    expect(aliceRead.state_version).toBe(session.state_version);
  });

  it('forbids a DELETED profile from every protected read and mutation', async () => {
    const disabled = await registerUser(app);
    const me = await as(disabled, '/api/me');
    expect(me.statusCode).toBe(200);
    const subjectId = (me.json() as { analytics_subject_id: string }).analytics_subject_id;

    const started = await as(disabled, { method: 'POST', url: '/api/sessions' });
    expect(started.statusCode).toBe(201);
    const session = started.json() as PublicSession;

    await db
      .update(userProfiles)
      .set({ status: 'DELETED', deletedAt: new Date() })
      .where(eq(userProfiles.analyticsSubjectId, subjectId));

    const dashboard = await as(disabled, '/api/dashboard');
    const resume = await as(disabled, `/api/sessions/${session.session_id}`);
    const action = await as(disabled, {
      method: 'POST',
      url: `/api/sessions/${session.session_id}/actions`,
      payload: {
        client_action_id: newUuid(),
        expected_state_version: session.state_version,
        action_type: 'ASSIGN_SLOT',
        payload: { slot: 'WHOLE', token_id: session.visible_chunks[0]!.tokens[0]!.token_id },
      },
    });

    for (const response of [dashboard, resume, action]) {
      expect(response.statusCode).toBe(403);
      expect((response.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN');
    }
  });
});
