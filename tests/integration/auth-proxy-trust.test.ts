import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../apps/api/src/app.js';
import { loadConfig, trustProxyOption } from '../../apps/api/src/config/index.js';
import { closePool } from '../../apps/api/src/db/index.js';

/**
 * Prove X-Forwarded-For cannot spoof auth rate-limit identity unless the TCP
 * peer is an explicitly trusted proxy.
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

async function signUp(
  app: FastifyInstance,
  email: string,
  opts: { forwardedFor?: string; remoteAddress?: string } = {},
): Promise<number> {
  const headers: Record<string, string> = {};
  if (opts.forwardedFor !== undefined) {
    headers['x-forwarded-for'] = opts.forwardedFor;
  }
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers,
    remoteAddress: opts.remoteAddress,
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
    expect(trustProxyOption(app.appConfig)).toBe(false);

    // Better Auth default special rule: 3 sign-ups / 10s per resolved IP.
    // Distinct spoofed XFF values must NOT create separate buckets.
    const statuses: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      statuses.push(
        await signUp(app, `untrust-${i}-${randomUUID()}@example.com`, {
          forwardedFor: `198.51.100.${i + 1}`,
        }),
      );
    }
    expect(statuses.every((s) => s < 400)).toBe(true);

    const blocked = await signUp(app, `untrust-block-${randomUUID()}@example.com`, {
      forwardedFor: '198.51.100.99',
    });
    expect(blocked).toBe(429);
  });

  it('trusted test proxy mode accepts the forwarded IP for rate-limit isolation', async () => {
    const config = loadConfig({ ...envBase(), TRUSTED_PROXIES: '127.0.0.1' });
    const app = await buildApp({ config });
    apps.push(app);
    expect(trustProxyOption(config)).toEqual(['127.0.0.1']);

    // Default inject peer is 127.0.0.1 (trusted). Unique XFF → distinct buckets.
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      statuses.push(
        await signUp(app, `trust-${i}-${randomUUID()}@example.com`, {
          forwardedFor: `198.51.100.${50 + i}`,
          remoteAddress: '127.0.0.1',
        }),
      );
    }
    expect(statuses.every((s) => s < 400)).toBe(true);
  });

  it('explicit-proxy: untrusted remote cannot control resolved IP via X-Forwarded-For', async () => {
    const config = loadConfig({ ...envBase(), TRUSTED_PROXIES: '127.0.0.1' });
    const app = await buildApp({ config });
    apps.push(app);
    // trustProxy enabled with only 127.0.0.1 trusted.
    expect(trustProxyOption(config)).toEqual(['127.0.0.1']);
    expect(app.appConfig.TRUSTED_PROXIES).toEqual(['127.0.0.1']);

    const untrustedPeer = '203.0.113.50';

    // Spoofed XFF values from the same untrusted remote must share one bucket.
    const statuses: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      statuses.push(
        await signUp(app, `peer-${i}-${randomUUID()}@example.com`, {
          forwardedFor: `198.51.100.${100 + i}`,
          remoteAddress: untrustedPeer,
        }),
      );
    }
    expect(statuses.every((s) => s < 400)).toBe(true);

    const blocked = await signUp(app, `peer-block-${randomUUID()}@example.com`, {
      forwardedFor: '198.51.100.200',
      remoteAddress: untrustedPeer,
    });
    expect(blocked).toBe(429);
  });
});
