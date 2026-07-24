import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api/src/app.js';
import { loadConfig } from '../../apps/api/src/config/index.js';
import { closePool } from '../../apps/api/src/db/index.js';

/**
 * Prove X-Forwarded-For cannot spoof auth rate-limit identity unless
 * TRUSTED_PROXIES is explicitly configured (test-only isolation mode).
 */

function envBase(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL:
      process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5439/reasoning_tutor',
    BETTER_AUTH_SECRET:
      process.env.BETTER_AUTH_SECRET ?? 'integration-test-secret-please-change-32',
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL ?? 'http://localhost:8080',
    TRUSTED_ORIGINS: process.env.TRUSTED_ORIGINS ?? 'http://localhost:8080',
    LOG_LEVEL: 'silent',
  };
}

async function signUp(app: FastifyInstance, email: string, forwardedFor?: string): Promise<number> {
  const headers: Record<string, string> = {};
  if (forwardedFor !== undefined) {
    headers['x-forwarded-for'] = forwardedFor;
  }
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers,
    payload: { email, password: 'Passw0rd!123', name: 'Proxy Trust' },
  });
  return res.statusCode;
}

describe('auth proxy trust / X-Forwarded-For isolation', () => {
  const apps: FastifyInstance[] = [];

  afterAll(async () => {
    for (const app of apps) {
      await app.close();
    }
    await closePool();
  });

  it('untrusted direct clients cannot control resolved client IP via X-Forwarded-For', async () => {
    const app = await buildApp({
      config: loadConfig({ ...envBase(), TRUSTED_PROXIES: '' }),
    });
    apps.push(app);

    // Better Auth default special rule: 3 sign-ups / 10s per resolved IP.
    // Distinct spoofed XFF values must NOT create separate buckets.
    const statuses: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      statuses.push(
        await signUp(app, `untrust-${i}-${randomUUID()}@example.com`, `198.51.100.${i + 1}`),
      );
    }
    expect(statuses.every((s) => s < 400)).toBe(true);

    const blocked = await signUp(app, `untrust-block-${randomUUID()}@example.com`, '198.51.100.99');
    expect(blocked).toBe(429);
  });

  it('trusted test proxy mode accepts the forwarded IP for rate-limit isolation', async () => {
    const app = await buildApp({
      config: loadConfig({ ...envBase(), TRUSTED_PROXIES: '127.0.0.1' }),
    });
    apps.push(app);

    // Four sign-ups with unique XFF must all succeed — each is a distinct bucket.
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      statuses.push(
        await signUp(app, `trust-${i}-${randomUUID()}@example.com`, `198.51.100.${50 + i}`),
      );
    }
    expect(statuses.every((s) => s < 400)).toBe(true);
  });
});
