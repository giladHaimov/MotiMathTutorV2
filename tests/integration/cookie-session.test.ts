import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { makeApp, uniqueTestIp } from '../helpers/app.js';
import { closePool } from '../../apps/api/src/db/index.js';
import { randomUUID } from 'node:crypto';

let app: FastifyInstance;

beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await closePool();
});

/**
 * Cookie-session architecture: Better Auth issues session cookies; protected
 * routes authenticate via cookie, not Authorization headers.
 */
describe('Better Auth cookie sessions', () => {
  it('registers with a session cookie and authenticates /api/me', async () => {
    const email = `cookie-${randomUUID()}@example.com`;
    const signUp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: {
        'x-forwarded-for': uniqueTestIp(email),
        origin: 'http://localhost:5173',
      },
      payload: { email, password: 'Passw0rd!123', name: 'Cookie User' },
    });
    expect(signUp.statusCode).toBeLessThan(400);
    expect(signUp.cookies.some((c) => c.name.includes('session_token'))).toBe(true);

    const cookie = signUp.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie },
    });
    expect(me.statusCode).toBe(200);
    const body = me.json() as { analytics_subject_id: string };
    expect(body.analytics_subject_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects unauthenticated /api/me', async () => {
    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
    });
    expect(me.statusCode).toBe(401);
  });

  it('rejects non-cookie Authorization credentials without a session cookie', async () => {
    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: 'Token not-a-session' },
    });
    expect(me.statusCode).toBe(401);
  });
});
