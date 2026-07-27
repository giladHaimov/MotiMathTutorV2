import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PublicSession } from '@app/contracts';
import { registerAuthRoutes } from '../../apps/api/src/auth/plugin.js';
import { loadConfig, type AppConfig } from '../../apps/api/src/config/index.js';
import { closePool, db } from '../../apps/api/src/db/index.js';
import {
  learningEvents,
  learningSessions,
  rollbackLogs,
  stageAttempts,
  userProfiles,
} from '../../apps/api/src/db/schema/product.js';
import { makeApp, newUuid, registerUser, uniqueTestIp, type TestUser } from '../helpers/app.js';

const password = 'Passw0rd!123';
const trustedConfig = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://postgres:postgres@localhost:5439/reasoning_tutor',
  BETTER_AUTH_SECRET: 'integration-test-secret-please-change-32',
  BETTER_AUTH_URL: 'https://trusted.example.test:8443/configured/base',
  TRUSTED_ORIGINS: 'https://trusted.example.test:8443',
  LOG_LEVEL: 'silent',
});

let app: FastifyInstance;
const proxyApps: FastifyInstance[] = [];

beforeAll(async () => {
  app = await makeApp();
});

afterAll(async () => {
  await Promise.all(proxyApps.map((proxy) => proxy.close()));
  await app.close();
  await closePool();
});

function as(user: TestUser, options: Parameters<FastifyInstance['inject']>[0]) {
  const request = typeof options === 'string' ? { url: options } : options;
  return app.inject({
    ...request,
    headers: { cookie: user.cookie, ...(request.headers ?? {}) },
  });
}

async function subjectId(user: TestUser): Promise<string> {
  const response = await as(user, '/api/me');
  expect(response.statusCode).toBe(200);
  return (response.json() as { analytics_subject_id: string }).analytics_subject_id;
}

function validAction(session: PublicSession, clientActionId = newUuid()) {
  return {
    client_action_id: clientActionId,
    expected_state_version: session.state_version,
    action_type: 'ASSIGN_SLOT' as const,
    payload: {
      slot: 'WHOLE' as const,
      token_id: session.visible_chunks[0]!.tokens[0]!.token_id,
    },
  };
}

interface SessionDbState {
  stateVersion: number;
  status: string;
  workspaceState: unknown;
  publicState: unknown;
  attempts: number;
  events: number;
  rollbacks: number;
}

async function sessionDbState(sessionId: string): Promise<SessionDbState> {
  const [session] = await db
    .select({
      stateVersion: learningSessions.stateVersion,
      status: learningSessions.status,
      workspaceState: learningSessions.workspaceState,
      publicState: learningSessions.publicState,
    })
    .from(learningSessions)
    .where(eq(learningSessions.id, sessionId));
  if (!session) throw new Error(`missing test session ${sessionId}`);

  const counts = await db
    .select({
      attempts: sql<number>`count(distinct ${stageAttempts.id})::int`,
      events: sql<number>`count(distinct ${learningEvents.id})::int`,
      rollbacks: sql<number>`count(distinct ${rollbackLogs.id})::int`,
    })
    .from(learningSessions)
    .leftJoin(stageAttempts, eq(stageAttempts.sessionId, learningSessions.id))
    .leftJoin(learningEvents, eq(learningEvents.sessionId, learningSessions.id))
    .leftJoin(rollbackLogs, eq(rollbackLogs.sessionId, learningSessions.id))
    .where(eq(learningSessions.id, sessionId));

  return { ...session, ...counts[0]! };
}

async function makeAuthProxy(
  handler: (request: Request) => Promise<Response>,
  config: AppConfig = trustedConfig,
): Promise<FastifyInstance> {
  const proxy = Fastify({ logger: false });
  proxyApps.push(proxy);
  proxy.decorate('auth', { handler } as FastifyInstance['auth']);
  proxy.decorate('appConfig', config);
  registerAuthRoutes(proxy);
  await proxy.ready();
  return proxy;
}

describe('auth security regressions', () => {
  it('centrally blocks a DELETED profile before protected reads and mutations touch SQL state', async () => {
    const user = await registerUser(app);
    const analyticsSubjectId = await subjectId(user);
    expect((await as(user, '/api/dashboard')).statusCode).toBe(200);

    const created = await as(user, { method: 'POST', url: '/api/sessions' });
    expect(created.statusCode).toBe(201);
    const session = created.json() as PublicSession;
    const before = await sessionDbState(session.session_id);

    await db
      .update(userProfiles)
      .set({ status: 'DELETED', deletedAt: new Date() })
      .where(eq(userProfiles.analyticsSubjectId, analyticsSubjectId));

    try {
      const responses = [
        await as(user, '/api/dashboard'),
        await as(user, `/api/sessions/${session.session_id}`),
        await as(user, {
          method: 'POST',
          url: `/api/sessions/${session.session_id}/actions`,
          payload: validAction(session),
        }),
      ];

      for (const response of responses) {
        expect(response.statusCode).toBe(403);
        expect(response.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
      }

      expect(await sessionDbState(session.session_id)).toEqual(before);
      expect((await app.inject({ url: '/api/dashboard' })).statusCode).toBe(401);
      expect((await app.inject({ url: `/api/sessions/${session.session_id}` })).statusCode).toBe(
        401,
      );
    } finally {
      await db
        .update(userProfiles)
        .set({ status: 'ACTIVE', deletedAt: null })
        .where(eq(userProfiles.analyticsSubjectId, analyticsSubjectId));
    }
  });

  it('enforces ownership in SQL-backed read and FOR UPDATE mutation flows without disclosure', async () => {
    const owner = await registerUser(app);
    const attacker = await registerUser(app);
    const created = await as(owner, { method: 'POST', url: '/api/sessions' });
    expect(created.statusCode).toBe(201);
    const session = created.json() as PublicSession;
    const before = await sessionDbState(session.session_id);

    const unauthorizedRead = await as(attacker, `/api/sessions/${session.session_id}`);
    const nonexistentRead = await as(attacker, `/api/sessions/${randomUUID()}`);
    for (const response of [unauthorizedRead, nonexistentRead]) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    }
    expect(unauthorizedRead.json().error.message).toBe(nonexistentRead.json().error.message);

    const attackerActionId = newUuid();
    const unauthorizedMutation = await as(attacker, {
      method: 'POST',
      url: `/api/sessions/${session.session_id}/actions`,
      payload: validAction(session, attackerActionId),
    });
    const nonexistentMutation = await as(attacker, {
      method: 'POST',
      url: `/api/sessions/${randomUUID()}/actions`,
      payload: validAction(session),
    });
    for (const response of [unauthorizedMutation, nonexistentMutation]) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    }
    expect(unauthorizedMutation.json().error.message).toBe(
      nonexistentMutation.json().error.message,
    );

    expect(await sessionDbState(session.session_id)).toEqual(before);
    const leakedAttempt = await db
      .select({ id: stageAttempts.id })
      .from(stageAttempts)
      .where(
        and(
          eq(stageAttempts.sessionId, session.session_id),
          eq(stageAttempts.clientActionId, attackerActionId),
        ),
      );
    expect(leakedAttempt).toEqual([]);

    expect((await as(owner, `/api/sessions/${session.session_id}`)).statusCode).toBe(200);
    const ownerMutation = await as(owner, {
      method: 'POST',
      url: `/api/sessions/${session.session_id}/actions`,
      payload: validAction(session),
    });
    expect(ownerMutation.statusCode).toBe(200);
    expect((ownerMutation.json() as PublicSession).state_version).toBe(session.state_version + 1);
  });

  it('allows only the owner mutation to advance a row when owner and attacker race', async () => {
    const owner = await registerUser(app);
    const attacker = await registerUser(app);
    const created = await as(owner, { method: 'POST', url: '/api/sessions' });
    expect(created.statusCode).toBe(201);
    const session = created.json() as PublicSession;
    const before = await sessionDbState(session.session_id);
    const ownerActionId = newUuid();
    const attackerActionId = newUuid();

    const [ownerResult, attackerResult] = await Promise.all([
      as(owner, {
        method: 'POST',
        url: `/api/sessions/${session.session_id}/actions`,
        payload: validAction(session, ownerActionId),
      }),
      as(attacker, {
        method: 'POST',
        url: `/api/sessions/${session.session_id}/actions`,
        payload: validAction(session, attackerActionId),
      }),
    ]);

    expect(ownerResult.statusCode).toBe(200);
    expect(attackerResult.statusCode).toBe(404);
    const after = await sessionDbState(session.session_id);
    expect(after.stateVersion).toBe(before.stateVersion + 1);
    expect(after.attempts).toBe(before.attempts + 1);
    expect(after.events).toBeGreaterThan(before.events);
    expect(after.rollbacks).toBe(before.rollbacks);

    const actionIds = await db
      .select({ clientActionId: stageAttempts.clientActionId })
      .from(stageAttempts)
      .where(eq(stageAttempts.sessionId, session.session_id));
    expect(actionIds.map((row) => row.clientActionId)).toContain(ownerActionId);
    expect(actionIds.map((row) => row.clientActionId)).not.toContain(attackerActionId);
    expect((await as(owner, `/api/sessions/${session.session_id}`)).statusCode).toBe(200);
  });

  it.each([
    {
      name: 'multiple cookies including Expires comma',
      response: () => {
        const headers = new Headers({ 'content-type': 'application/json', 'x-auth-result': 'ok' });
        headers.append(
          'set-cookie',
          'session=abc; Path=/; HttpOnly; Expires=Wed, 21 Oct 2037 07:28:00 GMT',
        );
        headers.append('set-cookie', 'refresh=def; Path=/api/auth; HttpOnly; SameSite=Lax');
        return new Response('{"ok":true}', { status: 202, headers });
      },
      expectedCookies: [
        'session=abc; Path=/; HttpOnly; Expires=Wed, 21 Oct 2037 07:28:00 GMT',
        'refresh=def; Path=/api/auth; HttpOnly; SameSite=Lax',
      ],
    },
    {
      name: 'one cookie',
      response: () =>
        new Response('single', {
          status: 201,
          headers: { 'set-cookie': 'session=one; Path=/; HttpOnly', 'x-auth-result': 'ok' },
        }),
      expectedCookies: ['session=one; Path=/; HttpOnly'],
    },
    {
      name: 'no cookies',
      response: () => new Response('none', { status: 200, headers: { 'x-auth-result': 'ok' } }),
      expectedCookies: undefined,
    },
  ])('preserves $name through the Fastify proxy', async ({ response, expectedCookies }) => {
    const proxy = await makeAuthProxy(async () => response());
    const result = await proxy.inject({ method: 'POST', url: '/api/auth/test', payload: {} });

    expect(result.headers['set-cookie']).toEqual(expectedCookies);
    expect(result.headers['x-auth-result']).toBe('ok');
    expect(result.statusCode).toBe(response().status);
    expect(result.body).toBe(await response().text());
  });

  it('keeps a real signup, session lookup, and logout cookie lifecycle working', async () => {
    const email = `security-cookie-${randomUUID()}@example.com`;
    const signUp = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { 'x-forwarded-for': uniqueTestIp(email) },
      payload: { email, password, name: 'Security Cookie' },
    });
    expect(signUp.statusCode).toBeLessThan(400);
    expect(signUp.cookies.some((cookie) => cookie.name.includes('session_token'))).toBe(true);
    const cookie = signUp.cookies.map((item) => `${item.name}=${item.value}`).join('; ');

    const session = await app.inject({
      method: 'GET',
      url: '/api/auth/get-session',
      headers: { cookie },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({ user: { email } });

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { cookie },
      payload: {},
    });
    expect(logout.statusCode).toBe(200);
    expect(logout.headers['set-cookie']).toBeDefined();
    expect((await as({ email, cookie }, '/api/me')).statusCode).toBe(401);
  });

  it.each([
    '/api/auth/session',
    '/api/auth/session?returnTo=%2Fdashboard%3Ftab%3D1&tag=one&tag=two',
  ])(
    'builds the Better Auth Request from configured URL plus exact path/query: %s',
    async (url) => {
      let received: URL | undefined;
      const proxy = await makeAuthProxy(async (request) => {
        received = new URL(request.url);
        return new Response('ok');
      });

      const result = await proxy.inject({
        method: 'GET',
        url,
        headers: {
          host: 'attacker.example:1234',
          'x-forwarded-host': 'forwarded-attacker.example:5678',
          forwarded: 'host=forwarded-header-attacker.example;proto=http',
        },
      });

      expect(result.statusCode).toBe(200);
      expect(received?.origin).toBe('https://trusted.example.test:8443');
      expect(received?.pathname).toBe(url.split('?')[0]);
      expect(received?.search).toBe(url.includes('?') ? `?${url.split('?')[1]}` : '');
      expect(received?.href).not.toContain('attacker.example');
      expect(received?.pathname).not.toContain('/configured/base');
    },
  );

  it('rejects missing and malformed BETTER_AUTH_URL during configuration', () => {
    const base = {
      NODE_ENV: 'test',
      DATABASE_URL: trustedConfig.DATABASE_URL,
      BETTER_AUTH_SECRET: trustedConfig.BETTER_AUTH_SECRET,
      TRUSTED_ORIGINS: '',
    };
    expect(() => loadConfig(base)).toThrow(/BETTER_AUTH_URL/);
    expect(() => loadConfig({ ...base, BETTER_AUTH_URL: 'not a url' })).toThrow(
      /BETTER_AUTH_URL must be a valid URL/,
    );
  });
});
