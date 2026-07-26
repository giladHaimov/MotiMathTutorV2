import { expect, test, type APIRequestContext, type APIResponse } from '@playwright/test';

const AUTH_BASE = '/api/auth';

function deployedOrigin(): string {
  const value = process.env.E2E_BASE_URL?.trim();
  if (!value) {
    throw new Error(
      'production-smoke.deploy.spec.ts requires E2E_BASE_URL, for example ' +
        'https://motimathtutorv2.onrender.com',
    );
  }
  const url = new URL(value);
  if (['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error(`production smoke rejects local E2E_BASE_URL values: ${url.origin}`);
  }
  return url.origin;
}

function uniqueTestUser(): { name: string; email: string; password: string } {
  const unique = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  return {
    name: `Render Smoke ${unique}`,
    email: `render-smoke-${unique}@example.test`,
    password: `Smoke-${crypto.randomUUID()}-Aa9!`,
  };
}

async function expectJson(response: APIResponse): Promise<unknown> {
  const contentType = response.headers()['content-type'] ?? '';
  expect(contentType).toContain('application/json');
  return response.json();
}

function browserLikeMutationHeaders(origin: string): Record<string, string> {
  return {
    Origin: origin,
    Referer: `${origin}/`,
  };
}

async function signUpWithRateLimitRetry(
  request: APIRequestContext,
  mutationHeaders: Record<string, string>,
  user: ReturnType<typeof uniqueTestUser>,
): Promise<APIResponse> {
  let response = await request.post(`${AUTH_BASE}/sign-up/email`, {
    headers: mutationHeaders,
    data: user,
  });
  if (response.status() === 429) {
    const retryAfter = Number(response.headers()['retry-after']);
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : 11_000;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    response = await request.post(`${AUTH_BASE}/sign-up/email`, {
      headers: mutationHeaders,
      data: user,
    });
  }
  return response;
}

test.describe('deployed production smoke', () => {
  test('public service, real auth, dashboard, session persistence, and logout work', async ({
    page,
    request,
  }) => {
    const origin = deployedOrigin();
    const mutationHeaders = browserLikeMutationHeaders(origin);
    const user = uniqueTestUser();

    await test.step('health confirms application and PostgreSQL readiness', async () => {
      const response = await request.get('/health');
      expect(response.status()).toBe(200);
      await expect(response.json()).resolves.toEqual({ status: 'ok' });
    });

    await test.step('deployed SPA and static assets load without network failures', async () => {
      const failedRequests: string[] = [];

      page.on('requestfailed', (failed) => {
        failedRequests.push(
          `${failed.method()} ${failed.url()}: ${failed.failure()?.errorText ?? 'unknown error'}`,
        );
      });

      // One clean navigation. No artificial reload and no ignored failures.
      const response = await page.goto('/', { waitUntil: 'networkidle' });

      expect(response?.status()).toBe(200);
      await expect(page.locator('body')).not.toBeEmpty();
      expect(failedRequests).toEqual([]);
    });

    await test.step('protected endpoint rejects an anonymous caller', async () => {
      const response = await request.get('/api/me');
      expect(response.status()).toBe(401);
    });

    await test.step('a disposable user can register through real Better Auth with valid Origin', async () => {
      const response = await signUpWithRateLimitRetry(request, mutationHeaders, user);

      expect(
        response.ok(),
        `Signup failed: ${response.status()} ${await response.text()}`,
      ).toBeTruthy();
    });

    let subjectId = '';

    await test.step('the authenticated cookie reaches the application API', async () => {
      const response = await request.get('/api/me');
      expect(response.status()).toBe(200);

      const body = (await expectJson(response)) as {
        analytics_subject_id?: string;
        status?: string;
        email?: unknown;
      };

      expect(body.analytics_subject_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(body.status).toBe('ACTIVE');
      expect(body).not.toHaveProperty('email');

      subjectId = body.analytics_subject_id!;
    });

    await test.step('dashboard loads from the deployed API and real database', async () => {
      const response = await request.get('/api/dashboard');
      expect(response.status()).toBe(200);

      const body = (await expectJson(response)) as {
        active_session: null | { session_id: string; status: string };
        next_problem_available: boolean;
      };

      expect(typeof body.next_problem_available).toBe('boolean');

      if (body.active_session) {
        expect(body.active_session.session_id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );
        expect(body.active_session.status).toBe('ACTIVE');
      }
    });

    let sessionId = '';
    let initialStateVersion = -1;

    await test.step('start-or-resume creates durable learner state', async () => {
      const response = await request.post('/api/sessions', {
        headers: mutationHeaders,
      });
      expect(response.status()).toBe(201);

      const session = (await expectJson(response)) as Record<string, unknown>;

      expect(session.session_id).toEqual(expect.any(String));
      expect(session.state_version).toEqual(expect.any(Number));
      expect(session.status).toMatch(/^(ACTIVE|COMPLETED)$/);
      expect(session.visible_chunks).toEqual(expect.any(Array));
      expect(session.allowed_actions).toEqual(expect.any(Array));
      expect(session.engine_version).toEqual(expect.any(String));
      expect(session.content_version).toEqual(expect.any(Number));

      for (const forbiddenKey of [
        'all_chunks',
        'hidden_chunks',
        'problem_definition',
        'expected_answer',
        'dependency_graph',
        'misconception_rules',
        'rollback_rules',
      ]) {
        expect(session).not.toHaveProperty(forbiddenKey);
      }

      sessionId = session.session_id as string;
      initialStateVersion = session.state_version as number;
    });

    await test.step('the same session resumes with stable identity and state', async () => {
      const response = await request.get(`/api/sessions/${sessionId}`);
      expect(response.status()).toBe(200);

      const resumed = (await expectJson(response)) as {
        session_id: string;
        state_version: number;
      };

      expect(resumed.session_id).toBe(sessionId);
      expect(resumed.state_version).toBe(initialStateVersion);
    });

    await test.step('dashboard now reports the active session', async () => {
      const response = await request.get('/api/dashboard');
      expect(response.status()).toBe(200);

      const dashboard = (await expectJson(response)) as {
        active_session: null | { session_id: string; status: string };
      };

      expect(dashboard.active_session?.session_id).toBe(sessionId);
      expect(dashboard.active_session?.status).toBe('ACTIVE');
    });

    await test.step('cookie-authenticated sign-out rejects an explicitly foreign Origin', async () => {
      // Better Auth trustedOrigins CSRF: authenticated session mutation with a
      // non-trusted Origin must fail and must not clear the cookie session.
      // Missing Origin is not asserted here: Playwright's APIRequestContext may
      // synthesize Origin from baseURL, and signup without Origin is allowed by
      // this Better Auth build — neither is treated as an app defect in this suite.
      const rejected = await request.post(`${AUTH_BASE}/sign-out`, {
        headers: {
          Origin: 'https://evil.example',
          Referer: 'https://evil.example/',
        },
        data: {},
      });
      expect(rejected.status(), await rejected.text()).toBe(403);
      const body = (await expectJson(rejected)) as { code?: string };
      expect(body.code).toBe('INVALID_ORIGIN');

      const stillAuthed = await request.get('/api/me');
      expect(stillAuthed.status(), await stillAuthed.text()).toBe(200);
    });

    await test.step('cookie-authenticated sign-out with valid Origin invalidates the session', async () => {
      const response = await request.post(`${AUTH_BASE}/sign-out`, {
        headers: mutationHeaders,
      });

      expect(
        response.ok(),
        `Logout failed: ${response.status()} ${await response.text()}`,
      ).toBeTruthy();

      const protectedResponse = await request.get('/api/me');
      expect(protectedResponse.status()).toBe(401);
    });

    test.info().annotations.push({
      type: 'smoke-test-user',
      description: `${user.email}; analytics subject ${subjectId}; session ${sessionId}`,
    });
  });
});
