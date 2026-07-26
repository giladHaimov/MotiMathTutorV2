import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../config/index.js';
import { registerAuthRoutes } from './plugin.js';

const config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://postgres:postgres@localhost:5439/reasoning_tutor',
  BETTER_AUTH_SECRET: 'unit-test-secret-please-change-32',
  BETTER_AUTH_URL: 'https://trusted.example:8443/ignored-base-path',
  TRUSTED_ORIGINS: 'https://trusted.example:8443',
  LOG_LEVEL: 'silent',
});

const apps: FastifyInstance[] = [];

async function makeAuthProxy(handler: (request: Request) => Promise<Response>) {
  const app = Fastify({ logger: false });
  apps.push(app);
  app.decorate('auth', { handler } as FastifyInstance['auth']);
  app.decorate('appConfig', config);
  registerAuthRoutes(app);
  await app.ready();
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('Better Auth proxy', () => {
  it('uses configured origin and preserves only the incoming path and query', async () => {
    let receivedUrl = '';
    const app = await makeAuthProxy(async (request) => {
      receivedUrl = request.url;
      return new Response('ok', { status: 202 });
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/session?returnTo=%2Fdashboard&mode=refresh',
      headers: {
        host: 'attacker.example',
        'x-forwarded-host': 'forwarded-attacker.example',
        forwarded: 'host=forwarded-header-attacker.example;proto=http',
      },
    });

    expect(receivedUrl).toBe(
      'https://trusted.example:8443/api/auth/session?returnTo=%2Fdashboard&mode=refresh',
    );
    expect(response.statusCode).toBe(202);
    expect(response.body).toBe('ok');
  });

  it('forwards multiple Set-Cookie values without combining comma-bearing attributes', async () => {
    const app = await makeAuthProxy(async () => {
      const headers = new Headers();
      headers.append(
        'set-cookie',
        'session=abc; Path=/; HttpOnly; Expires=Wed, 21 Oct 2037 07:28:00 GMT',
      );
      headers.append('set-cookie', 'refresh=def; Path=/api/auth; HttpOnly; SameSite=Lax');
      headers.set('x-auth-result', 'created');
      return new Response('created', { status: 201, headers });
    });

    const response = await app.inject({ method: 'POST', url: '/api/auth/sign-in/email' });

    expect(response.headers['set-cookie']).toEqual([
      'session=abc; Path=/; HttpOnly; Expires=Wed, 21 Oct 2037 07:28:00 GMT',
      'refresh=def; Path=/api/auth; HttpOnly; SameSite=Lax',
    ]);
    expect(response.headers['x-auth-result']).toBe('created');
    expect(response.statusCode).toBe(201);
    expect(response.body).toBe('created');
  });

  it('preserves single-cookie and no-cookie responses', async () => {
    const withCookie = await makeAuthProxy(
      async () =>
        new Response('single', {
          headers: { 'set-cookie': 'session=one; Path=/; HttpOnly' },
        }),
    );
    const single = await withCookie.inject({ method: 'GET', url: '/api/auth/get-session' });
    expect(single.headers['set-cookie']).toEqual(['session=one; Path=/; HttpOnly']);

    const withoutCookie = await makeAuthProxy(async () => new Response(null, { status: 204 }));
    const none = await withoutCookie.inject({ method: 'GET', url: '/api/auth/get-session' });
    expect(none.headers['set-cookie']).toBeUndefined();
    expect(none.statusCode).toBe(204);
    expect(none.body).toBe('');
  });
});
