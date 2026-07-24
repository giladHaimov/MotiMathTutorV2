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

function authTokenHeader(res: { headers: Record<string, unknown> }): string | null {
  const raw = res.headers['set-auth-token'];
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0];
  return null;
}

/**
 * Cookie-session only: Better Auth never issues bearer / set-auth-token,
 * including when caller-controlled native headers/origins are present.
 */
describe('Better Auth cookie sessions (no bearer issuance)', () => {
  it('issues cookie sessions for browser clients and never set-auth-token', async () => {
    const email = `browser-${randomUUID()}@example.com`;
    const signUp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: {
        'x-forwarded-for': uniqueTestIp(email),
        origin: 'http://localhost:5173',
      },
      payload: { email, password: 'Passw0rd!123', name: 'Browser User' },
    });
    expect(signUp.statusCode).toBeLessThan(400);
    expect(authTokenHeader(signUp)).toBeNull();
    expect(signUp.cookies.some((c) => c.name.includes('session_token'))).toBe(true);

    const cookie = signUp.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie },
    });
    expect(me.statusCode).toBe(200);
  });

  it('does not issue set-auth-token for Capacitor-like headers/origins', async () => {
    const email = `native-${randomUUID()}@example.com`;
    const signUp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: {
        'x-forwarded-for': uniqueTestIp(email),
        'x-client-platform': 'capacitor',
        origin: 'capacitor://localhost',
      },
      payload: { email, password: 'Passw0rd!123', name: 'Native User' },
    });
    expect(signUp.statusCode).toBeLessThan(400);
    expect(authTokenHeader(signUp)).toBeNull();

    const exposed = signUp.headers['access-control-expose-headers'];
    const exposedText = Array.isArray(exposed) ? exposed.join(',') : String(exposed ?? '');
    expect(exposedText.toLowerCase()).not.toContain('set-auth-token');

    // Cookie path still works when Origin is a trusted Capacitor packaging origin.
    expect(signUp.cookies.some((c) => c.name.includes('session_token'))).toBe(true);
  });

  it('Authorization Bearer is not an approved auth path', async () => {
    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(me.statusCode).toBe(401);
  });
});
