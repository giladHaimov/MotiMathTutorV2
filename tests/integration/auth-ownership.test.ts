import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, registerUser, newUuid, type TestUser } from '../helpers/app.js';
import { closePool } from '../../apps/api/src/db/index.js';
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
});
