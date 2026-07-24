import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api/src/app.js';

/**
 * Build the REAL Fastify app (no mocks) backed by the real PostgreSQL. Tests use
 * `app.inject` for in-process HTTP against the genuine routes, auth, and DB.
 */
export async function makeApp(): Promise<FastifyInstance> {
  return buildApp();
}

export interface TestUser {
  email: string;
  cookie: string;
}

/** Register a fresh user through the real Better Auth endpoint; return its session cookie. */
export async function registerUser(app: FastifyInstance): Promise<TestUser> {
  const email = `user-${randomUUID()}@example.com`;
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    payload: { email, password: 'Passw0rd!123', name: 'Test User' },
  });
  if (res.statusCode >= 400) {
    throw new Error(`sign-up failed (${res.statusCode}): ${res.body}`);
  }
  const cookie = res.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  return { email, cookie };
}

export function newUuid(): string {
  return randomUUID();
}
