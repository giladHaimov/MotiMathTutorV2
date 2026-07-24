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
 * Capacitor-approved bearer/session-token path (ARCHITECTURE §2 / §17).
 * Browser clients must not receive set-auth-token; native clients may.
 */
describe('Better Auth bearer session token (native-only issuance)', () => {
  it('does not issue set-auth-token to browser clients', async () => {
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

  it('issues set-auth-token only to native Capacitor clients and accepts Bearer', async () => {
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
    const bearer = authTokenHeader(signUp);
    expect(bearer).toBeTruthy();

    const exposed = signUp.headers['access-control-expose-headers'];
    const exposedText = Array.isArray(exposed) ? exposed.join(',') : String(exposed ?? '');
    expect(exposedText.toLowerCase()).toContain('set-auth-token');

    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { authorization: `Bearer ${bearer}` },
    });
    expect(me.statusCode).toBe(200);
    const body = me.json() as { analytics_subject_id: string };
    expect(body.analytics_subject_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('Origin spoof alone does not issue a bearer token', async () => {
    const email = `spoof-${randomUUID()}@example.com`;
    const signUp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: {
        'x-forwarded-for': uniqueTestIp(email),
        origin: 'capacitor://localhost',
      },
      payload: { email, password: 'Passw0rd!123', name: 'Spoof User' },
    });
    expect(signUp.statusCode).toBeLessThan(400);
    expect(authTokenHeader(signUp)).toBeNull();
  });

  it('spoofed X-Client-Platform from a browser Origin does not issue a bearer token', async () => {
    const email = `header-spoof-${randomUUID()}@example.com`;
    const signUp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: {
        'x-forwarded-for': uniqueTestIp(email),
        'x-client-platform': 'capacitor',
        origin: 'http://localhost:5173',
      },
      payload: { email, password: 'Passw0rd!123', name: 'Header Spoof' },
    });
    expect(signUp.statusCode).toBeLessThan(400);
    expect(authTokenHeader(signUp)).toBeNull();
  });
});
