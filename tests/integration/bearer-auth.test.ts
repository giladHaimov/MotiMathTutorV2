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
 * Capacitor-approved bearer/session-token path (ARCHITECTURE §2 / §17).
 * Cookie sessions remain the web path; bearer authenticates without cookies.
 */
describe('Better Auth bearer session token (Capacitor path)', () => {
  it('authenticates /api/me with Authorization Bearer and no cookie', async () => {
    const email = `bearer-${randomUUID()}@example.com`;
    const signUp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { 'x-forwarded-for': uniqueTestIp(email) },
      payload: { email, password: 'Passw0rd!123', name: 'Bearer User' },
    });
    expect(signUp.statusCode).toBeLessThan(400);

    const token =
      signUp.headers['set-auth-token'] ??
      (typeof signUp.headers['set-auth-token'] === 'string'
        ? signUp.headers['set-auth-token']
        : undefined);
    // Fastify may normalize header names; also accept cookie value as fallback token.
    let bearer =
      (typeof token === 'string' ? token : Array.isArray(token) ? token[0] : undefined) ?? null;
    if (!bearer) {
      const sessionCookie = signUp.cookies.find((c) => c.name.includes('session_token'));
      bearer = sessionCookie?.value ?? null;
    }
    expect(bearer).toBeTruthy();

    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${bearer}` },
    });
    expect(me.statusCode).toBe(200);
    const body = me.json() as { analytics_subject_id: string };
    expect(body.analytics_subject_id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
