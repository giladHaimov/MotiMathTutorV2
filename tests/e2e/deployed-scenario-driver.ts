import {
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from '@playwright/test';
import { publicSessionSchema, type PublicSession } from '@app/contracts';
import type { Scenario, ScenarioStep, SessionRef, UserRef } from '../scenarios/catalog.js';

interface RuntimeUser {
  context: APIRequestContext;
  email: string;
  password: string;
  ownsContext: boolean;
}

interface LastResult {
  response: APIResponse;
  before: PublicSession | null;
  session: PublicSession | null;
  clientActionId: string | null;
  duplicateWasEquivalent: boolean;
}

const forbiddenPublicKeys = [
  'all_chunks',
  'hidden_chunks',
  'problem_definition',
  'expected_answer',
  'expected_final_result',
  'dependency_graph',
  'misconception_rules',
  'rollback_rules',
  'definition',
] as const;

function deployedOrigin(): string {
  const value = process.env.E2E_BASE_URL?.trim();
  if (!value) {
    throw new Error(
      'deployed scenario suites require E2E_BASE_URL, for example ' +
        'https://motimathtutorv2.onrender.com',
    );
  }
  const url = new URL(value);
  if (['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error(`deployed scenario suites reject local E2E_BASE_URL values: ${url.origin}`);
  }
  return url.origin;
}

function stepError(scenario: Scenario, index: number, message: string): never {
  throw new Error(`${scenario.id} step ${index + 1} (${scenario.steps[index]!.type}): ${message}`);
}

async function responseBody(response: APIResponse): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function responseSummary(response: APIResponse): Promise<string> {
  return `${response.status()} ${JSON.stringify(await responseBody(response))}`;
}

async function rateLimitDelay(response: APIResponse): Promise<void> {
  const retryAfter = Number(response.headers()['retry-after']);
  const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : 11_000;
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

function problemKey(session: PublicSession): string {
  const tokenId = session.visible_chunks[0]?.tokens[0]?.token_id ?? '';
  const match = /^ex(0[1-4])-/.exec(tokenId);
  return match ? `EX-${match[1]}` : 'UNKNOWN';
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function durablePublicState(session: PublicSession): unknown {
  return {
    status: session.status,
    visible_chunks: session.visible_chunks,
    workspace: session.workspace,
    accepted_commitments: session.accepted_commitments,
  };
}

/** Learner-visible durable fields; excludes ephemeral conflict/reload messages. */
function authoritativeLearnerState(session: PublicSession): unknown {
  return {
    session_id: session.session_id,
    state_version: session.state_version,
    status: session.status,
    visible_chunks: session.visible_chunks,
    workspace: session.workspace,
    accepted_commitments: session.accepted_commitments,
    allowed_actions: session.allowed_actions,
    required_next_action: session.required_next_action,
    engine_version: session.engine_version,
    content_version: session.content_version,
  };
}

async function parsePublicSession(
  scenario: Scenario,
  index: number,
  response: APIResponse,
): Promise<PublicSession> {
  const contentType = response.headers()['content-type'] ?? '';
  if (!contentType.includes('application/json')) {
    stepError(scenario, index, `expected JSON response, got ${contentType || '<none>'}`);
  }
  const parsed = publicSessionSchema.safeParse(await responseBody(response));
  if (!parsed.success) {
    stepError(scenario, index, `invalid public session schema: ${parsed.error.message}`);
  }
  assertPublicPayload(scenario, index, parsed.data);
  return parsed.data;
}

function assertPublicPayload(scenario: Scenario, index: number, body: unknown): void {
  const serialized = JSON.stringify(body);
  for (const key of forbiddenPublicKeys) {
    if (new RegExp(`"${key}"\\s*:`).test(serialized)) {
      stepError(scenario, index, `public response exposed forbidden field ${key}`);
    }
  }
  if (typeof body !== 'object' || body === null || !('visible_chunks' in body)) return;
  const session = body as PublicSession;
  expect(
    session.visible_chunks.map((chunk) => chunk.order_index),
    `${scenario.id} step ${index + 1}: visible chunks must be a contiguous prefix`,
  ).toEqual(session.visible_chunks.map((_, chunkIndex) => chunkIndex));
}

export class DeployedScenarioDriver {
  private readonly origin = deployedOrigin();
  private readonly users = new Map<UserRef, RuntimeUser>();
  private readonly sessions = new Map<string, PublicSession>();
  private readonly actionIds = new Map<string, string>();
  private last: LastResult | null = null;
  private usedCriticalUiAssign = false;
  private usedCriticalUiFinal = false;

  constructor(
    private readonly page: Page,
    private readonly step: (title: string, body: () => Promise<void>) => Promise<void>,
  ) {}

  async run(scenario: Scenario): Promise<void> {
    try {
      await this.step(`${scenario.id}: anonymous APIs are protected`, async () => {
        const anonymous = await playwrightRequest.newContext({ baseURL: this.origin });
        try {
          const response = await anonymous.get('/api/me');
          expect(response.status(), await responseSummary(response)).toBe(401);
        } finally {
          await anonymous.dispose();
        }
      });

      for (let index = 0; index < scenario.steps.length; index += 1) {
        const scenarioStep = scenario.steps[index]!;
        await this.step(
          `${scenario.id} ${index + 1}/${scenario.steps.length}: ${scenarioStep.type}`,
          () => this.execute(scenario, index, scenarioStep),
        );
        if (scenario.id === 'JS-03' && this.users.size === 2) {
          await this.assertCrossUserIsolation(scenario, index);
        }
      }

      if (scenario.id === 'JS-24') {
        await this.step(
          `${scenario.id}: completed session leaves dashboard without an active resume`,
          async () => {
            const completed = this.getSession(scenario, scenario.steps.length - 1, 'ex01');
            expect(
              completed.status,
              `${scenario.id}: in-memory session must be COMPLETED before dashboard check`,
            ).toBe('COMPLETED');

            const authoritativeResponse = await this.getUser(
              scenario,
              scenario.steps.length - 1,
            ).context.get(`/api/sessions/${completed.session_id}`);
            expect(
              authoritativeResponse.status(),
              await responseSummary(authoritativeResponse),
            ).toBe(200);
            const authoritative = await parsePublicSession(
              scenario,
              scenario.steps.length - 1,
              authoritativeResponse,
            );
            expect(authoritative.status).toBe('COMPLETED');
            expect(authoritative.session_id).toBe(completed.session_id);

            await this.page.reload({ waitUntil: 'networkidle' });
            await expect(this.page.getByTestId('dashboard')).toBeVisible();
            await expect(this.page.getByTestId('dashboard-empty')).toBeVisible();
            await expect(this.page.getByTestId('resume-session')).toHaveCount(0);
            await expect(this.page.getByTestId('start-session')).toBeVisible();
          },
        );
      }
    } finally {
      await Promise.all(
        [...this.users.values()]
          .filter((user) => user.ownsContext)
          .map((user) => user.context.dispose()),
      );
    }
  }

  private key(user: UserRef, session: SessionRef): string {
    return `${user}:${session}`;
  }

  private getUser(scenario: Scenario, index: number, ref: UserRef = 'primary'): RuntimeUser {
    const user = this.users.get(ref);
    if (!user) stepError(scenario, index, `user ${ref} is not registered`);
    return user;
  }

  private getSession(
    scenario: Scenario,
    index: number,
    ref: SessionRef,
    user: UserRef = 'primary',
  ): PublicSession {
    const session = this.sessions.get(this.key(user, ref));
    if (!session) stepError(scenario, index, `session ${user}:${ref} does not exist`);
    return session;
  }

  private storeSession(user: UserRef, ref: SessionRef, session: PublicSession): void {
    this.sessions.set(this.key(user, ref), session);
    this.sessions.set(this.key(user, 'current'), session);
  }

  private async execute(scenario: Scenario, index: number, step: ScenarioStep): Promise<void> {
    switch (step.type) {
      case 'register':
        return this.register(scenario, index, step.user ?? 'primary');
      case 'login':
        return this.login(scenario, index, step.user ?? 'primary', step.wrongPassword ?? false);
      case 'logout':
        return this.logout(scenario, index, step.user ?? 'primary');
      case 'startSession':
        return this.startSession(scenario, index, step);
      case 'submitAction':
        return this.submitAction(scenario, index, step);
      case 'expectState':
        return this.expectState(scenario, index, step);
      case 'expectRejected':
        return this.expectRejected(scenario, index, step);
      case 'expectResponseHasNoFutureChunk':
        return stepError(
          scenario,
          index,
          'aggregate response-history assertions are intentionally local-only',
        );
      case 'restartBackend':
        return this.authoritativeRefresh(scenario, index, step);
      case 'assertDbRows':
        return stepError(scenario, index, 'database-row assertions are intentionally local-only');
      case 'concurrent':
        return this.concurrent(scenario, index, step);
      case 'activateContentVersion':
        return stepError(scenario, index, 'content activation is intentionally local-only');
    }
  }

  private async register(scenario: Scenario, index: number, ref: UserRef): Promise<void> {
    const unique = `${Date.now()}-${crypto.randomUUID()}`;
    const email = `deploy-${scenario.id.toLowerCase()}-${ref}-${unique}@example.test`;
    const password = `Deploy-${crypto.randomUUID()}-Aa9!`;
    const context =
      ref === 'primary'
        ? this.page.request
        : await playwrightRequest.newContext({
            baseURL: this.origin,
            extraHTTPHeaders: { Origin: this.origin, Referer: `${this.origin}/` },
          });
    let response = await context.post('/api/auth/sign-up/email', {
      headers: { Origin: this.origin, Referer: `${this.origin}/` },
      data: { email, password, name: `${scenario.id} ${ref}` },
    });
    if (response.status() === 429) {
      await rateLimitDelay(response);
      response = await context.post('/api/auth/sign-up/email', {
        headers: { Origin: this.origin, Referer: `${this.origin}/` },
        data: { email, password, name: `${scenario.id} ${ref}` },
      });
    }
    if (response.status() !== 200) {
      stepError(scenario, index, `registration returned ${await responseSummary(response)}`);
    }
    this.users.set(ref, { context, email, password, ownsContext: ref !== 'primary' });
    this.last = {
      response,
      before: null,
      session: null,
      clientActionId: null,
      duplicateWasEquivalent: false,
    };
    if (ref === 'primary') {
      await this.page.goto('/', { waitUntil: 'networkidle' });
      await expect(this.page.getByTestId('dashboard')).toBeVisible();
    }
  }

  private async login(
    scenario: Scenario,
    index: number,
    ref: UserRef,
    wrongPassword: boolean,
  ): Promise<void> {
    const user = this.getUser(scenario, index, ref);
    const response = await user.context.post('/api/auth/sign-in/email', {
      headers: { Origin: this.origin, Referer: `${this.origin}/` },
      data: {
        email: user.email,
        password: wrongPassword ? `${user.password}-wrong` : user.password,
      },
    });
    if (wrongPassword) {
      expect(response.status(), await responseSummary(response)).toBeGreaterThanOrEqual(400);
      expect(response.status()).toBeLessThan(500);
    } else {
      expect(response.status(), await responseSummary(response)).toBe(200);
    }
    this.last = {
      response,
      before: null,
      session: null,
      clientActionId: null,
      duplicateWasEquivalent: false,
    };
  }

  private async logout(scenario: Scenario, index: number, ref: UserRef): Promise<void> {
    const response = await this.getUser(scenario, index, ref).context.post('/api/auth/sign-out', {
      headers: { Origin: this.origin, Referer: `${this.origin}/` },
    });
    expect(response.status(), await responseSummary(response)).toBe(200);
    this.last = {
      response,
      before: null,
      session: null,
      clientActionId: null,
      duplicateWasEquivalent: false,
    };
  }

  private async startSession(
    scenario: Scenario,
    index: number,
    step: Extract<ScenarioStep, { type: 'startSession' }>,
  ): Promise<void> {
    const userRef = step.user ?? 'primary';
    const prior = step.expectSameAs
      ? this.getSession(scenario, index, step.expectSameAs, userRef)
      : null;
    const response = await this.getUser(scenario, index, userRef).context.post('/api/sessions', {
      headers: { Origin: this.origin, Referer: `${this.origin}/` },
    });
    expect(response.status(), await responseSummary(response)).toBe(201);
    const session = await parsePublicSession(scenario, index, response);
    expect(problemKey(session)).toBe(step.expectedProblem);
    if (prior) expect(session.session_id).toBe(prior.session_id);
    this.storeSession(userRef, step.session, session);
    this.last = {
      response,
      before: prior,
      session,
      clientActionId: null,
      duplicateWasEquivalent: false,
    };
  }

  private async submitAction(
    scenario: Scenario,
    index: number,
    step: Extract<ScenarioStep, { type: 'submitAction' }>,
  ): Promise<void> {
    if (step.injectFailure) {
      stepError(scenario, index, 'fault injection is intentionally local-only');
    }
    const userRef = step.user ?? 'primary';
    const before = this.getSession(scenario, index, step.session, userRef);
    const idKey = `${scenario.id}:${step.clientActionKey ?? crypto.randomUUID()}`;
    const clientActionId = this.actionIds.get(idKey) ?? crypto.randomUUID();
    this.actionIds.set(idKey, clientActionId);
    const data = {
      client_action_id: clientActionId,
      expected_state_version: Math.max(0, before.state_version - (step.staleBy ?? 0)),
      action_type: step.actionType,
      payload: step.payload,
    };

    let response: APIResponse;
    if (
      scenario.id === 'JS-24' &&
      !this.usedCriticalUiAssign &&
      step.actionType === 'ASSIGN_SLOT'
    ) {
      await this.page.reload({ waitUntil: 'networkidle' });
      await expect(this.page.getByTestId('dashboard')).toBeVisible();
      await this.page.getByTestId('resume-session').click();
      await expect(this.page.getByTestId('problem-screen')).toBeVisible();
      await this.page.getByTestId(`token-${String(step.payload.token_id)}`).click();
      await this.page.getByTestId(`assign-${String(step.payload.slot)}`).click();
      await expect(this.page.getByTestId('state-version')).toHaveText(
        String(before.state_version + 1),
      );
      response = await this.getUser(scenario, index, userRef).context.get(
        `/api/sessions/${before.session_id}`,
      );
      this.usedCriticalUiAssign = true;
    } else if (
      scenario.id === 'JS-24' &&
      !this.usedCriticalUiFinal &&
      step.actionType === 'SUBMIT_FINAL_ANSWER'
    ) {
      await this.page.reload({ waitUntil: 'networkidle' });
      await expect(this.page.getByTestId('dashboard')).toBeVisible();
      await this.page.getByTestId('resume-session').click();
      await expect(this.page.getByTestId('problem-screen')).toBeVisible();
      await expect(this.page.getByTestId('final-answer-input')).toBeVisible();
      await this.page.getByTestId('final-answer-input').fill(String(step.payload.value ?? ''));
      await this.page.getByTestId('submit-answer').click();
      await expect(this.page.getByTestId('completed')).toBeVisible();
      await expect(this.page.getByTestId('status')).toHaveText('COMPLETED');
      response = await this.getUser(scenario, index, userRef).context.get(
        `/api/sessions/${before.session_id}`,
      );
      this.usedCriticalUiFinal = true;
    } else {
      response = await this.getUser(scenario, index, userRef).context.post(
        `/api/sessions/${before.session_id}/actions`,
        {
          headers: { Origin: this.origin, Referer: `${this.origin}/` },
          data,
        },
      );
    }

    const session =
      response.status() === 200
        ? await parsePublicSession(scenario, index, response)
        : await this.parseConflictCurrentState(scenario, index, response);
    let duplicateWasEquivalent = false;
    if (step.duplicate) {
      const replay = await this.getUser(scenario, index, userRef).context.post(
        `/api/sessions/${before.session_id}/actions`,
        {
          headers: { Origin: this.origin, Referer: `${this.origin}/` },
          data,
        },
      );
      const replaySession =
        replay.status() === 200
          ? await parsePublicSession(scenario, index, replay)
          : await this.parseConflictCurrentState(scenario, index, replay);
      expect(replay.status(), await responseSummary(replay)).toBe(response.status());
      expect(canonicalJson(replaySession)).toBe(canonicalJson(session));
      duplicateWasEquivalent = true;
    }

    if (response.status() === 200) {
      const stateChanged =
        canonicalJson(durablePublicState(before)) !== canonicalJson(durablePublicState(session));
      expect(session.session_id).toBe(before.session_id);
      expect(session.state_version).toBe(before.state_version + (stateChanged ? 1 : 0));
      const authoritativeResponse = await this.getUser(scenario, index, userRef).context.get(
        `/api/sessions/${before.session_id}`,
      );
      expect(authoritativeResponse.status(), await responseSummary(authoritativeResponse)).toBe(
        200,
      );
      const authoritative = await parsePublicSession(scenario, index, authoritativeResponse);
      expect(authoritative).toEqual(session);
    }
    this.storeSession(userRef, step.session, session);
    this.last = { response, before, session, clientActionId, duplicateWasEquivalent };
  }

  private async parseConflictCurrentState(
    scenario: Scenario,
    index: number,
    response: APIResponse,
  ): Promise<PublicSession> {
    const body = await responseBody(response);
    if (
      response.status() !== 409 ||
      typeof body !== 'object' ||
      body === null ||
      !('error' in body) ||
      !('current_state' in body)
    ) {
      stepError(
        scenario,
        index,
        `unexpected action response ${response.status()}: ${JSON.stringify(body)}`,
      );
    }
    const error = (body as { error: { code?: unknown } }).error;
    expect(error.code).toBe('STATE_VERSION_CONFLICT');
    assertPublicPayload(scenario, index, body);
    const parsed = publicSessionSchema.safeParse(
      (body as { current_state: unknown }).current_state,
    );
    if (!parsed.success)
      stepError(scenario, index, `invalid conflict current_state: ${parsed.error.message}`);
    return parsed.data;
  }

  private async expectState(
    scenario: Scenario,
    index: number,
    step: Extract<ScenarioStep, { type: 'expectState' }>,
  ): Promise<void> {
    const session = this.getSession(scenario, index, step.session);
    const label = `${scenario.id} step ${index + 1} expectState`;
    if (step.status !== undefined) {
      expect(session.status, `${label}: status`).toBe(step.status);
    }
    if (step.visibleCount !== undefined) {
      expect(session.visible_chunks, `${label}: visibleCount`).toHaveLength(step.visibleCount);
    }
    if (step.stateVersion !== undefined) {
      expect(session.state_version, `${label}: stateVersion`).toBe(step.stateVersion);
    }
    if (step.stateVersionAtLeast !== undefined) {
      expect(session.state_version, `${label}: stateVersionAtLeast`).toBeGreaterThanOrEqual(
        step.stateVersionAtLeast,
      );
    }
    if (step.requiredAction !== undefined) {
      expect(session.required_next_action.action_type, `${label}: requiredAction`).toBe(
        step.requiredAction,
      );
    }
    if (step.guidanceCode !== undefined) {
      expect(session.guidance_code, `${label}: guidanceCode`).toBe(step.guidanceCode);
    }
    if (step.slot) {
      expect(
        session.workspace.slots.find((slot) => slot.slot === step.slot!.name)?.token_id,
        `${label}: slot ${step.slot.name}`,
      ).toBe(step.slot.tokenId);
    }
  }

  private async expectRejected(
    scenario: Scenario,
    index: number,
    step: Extract<ScenarioStep, { type: 'expectRejected' }>,
  ): Promise<void> {
    const label = `${scenario.id} step ${index + 1} expectRejected`;
    if (!this.last) stepError(scenario, index, 'there is no prior response to assert');
    if (step.statusCode !== undefined) {
      expect(this.last.response.status(), `${label}: statusCode`).toBe(step.statusCode);
    }
    if (step.stateUnchanged && this.last.before && this.last.session) {
      expect(
        this.last.session.state_version,
        `${label}: stateUnchanged (before=${this.last.before.state_version}, after=${this.last.session.state_version}, status=${this.last.session.status})`,
      ).toBe(this.last.before.state_version);
    }
    // Misconception codes are deliberately not public. The scenario's public
    // consequence (message/guidance/state) is asserted without reading DB rows.
    if (step.misconception) {
      stepError(
        scenario,
        index,
        `misconception code ${step.misconception} is intentionally absent from the public API`,
      );
    }
  }

  private async authoritativeRefresh(
    scenario: Scenario,
    index: number,
    step: Extract<ScenarioStep, { type: 'restartBackend' }>,
  ): Promise<void> {
    const userRef = step.user ?? 'primary';
    const before = this.getSession(scenario, index, step.session, userRef);
    if (userRef === 'primary') {
      await this.page.reload({ waitUntil: 'networkidle' });
    }
    const response = await this.getUser(scenario, index, userRef).context.get(
      `/api/sessions/${before.session_id}`,
    );
    expect(response.status(), await responseSummary(response)).toBe(200);
    const session = await parsePublicSession(scenario, index, response);
    expect(session).toEqual(before);
    this.storeSession(userRef, step.session, session);
    this.last = {
      response,
      before,
      session,
      clientActionId: null,
      duplicateWasEquivalent: false,
    };
  }

  private async concurrent(
    scenario: Scenario,
    index: number,
    step: Extract<ScenarioStep, { type: 'concurrent' }>,
  ): Promise<void> {
    const userRef = step.user ?? 'primary';
    const user = this.getUser(scenario, index, userRef);
    const before = this.getSession(scenario, index, step.session, userRef);
    const responses = await Promise.all(
      step.actions.map((action) =>
        user.context.post(`/api/sessions/${before.session_id}/actions`, {
          headers: { Origin: this.origin, Referer: `${this.origin}/` },
          data: {
            client_action_id: crypto.randomUUID(),
            expected_state_version: before.state_version,
            action_type: action.actionType,
            payload: action.payload,
          },
        }),
      ),
    );
    expect(
      responses.map((response) => response.status()).sort(),
      `JS-13 concurrent statuses: ${(
        await Promise.all(responses.map((response) => responseSummary(response)))
      ).join(' | ')}`,
    ).toEqual([200, 409]);
    const winner = responses.find((response) => response.status() === 200)!;
    const conflict = responses.find((response) => response.status() === 409)!;
    const session = await parsePublicSession(scenario, index, winner);
    const conflictState = await this.parseConflictCurrentState(scenario, index, conflict);
    // Conflict responses attach a reload message; durable learner state must still match.
    expect(
      authoritativeLearnerState(conflictState),
      `conflict current_state durable mismatch vs winner: conflict=${JSON.stringify(
        conflictState,
      )} winner=${JSON.stringify(session)}`,
    ).toEqual(authoritativeLearnerState(session));
    expect(conflictState.message).toBe('The session changed. Reloaded current state.');
    expect(session.message).toBeNull();
    expect(session.state_version).toBe(before.state_version + 1);
    this.storeSession(userRef, step.session, session);
    this.last = {
      response: winner,
      before,
      session,
      clientActionId: null,
      duplicateWasEquivalent: false,
    };
  }

  private async assertCrossUserIsolation(_scenario: Scenario, _index: number): Promise<void> {
    for (const [key, session] of this.sessions) {
      if (key.endsWith(':current')) continue;
      const owner: UserRef = key.startsWith('primary:') ? 'primary' : 'secondary';
      const intruder: UserRef = owner === 'primary' ? 'secondary' : 'primary';
      const intruderUser = this.users.get(intruder);
      if (!intruderUser) continue;
      const read = await intruderUser.context.get(`/api/sessions/${session.session_id}`);
      expect(
        read.status(),
        `${intruder} read ${owner}'s session: ${await responseSummary(read)}`,
      ).toBe(404);
      const mutate = await intruderUser.context.post(
        `/api/sessions/${session.session_id}/actions`,
        {
          headers: { Origin: this.origin, Referer: `${this.origin}/` },
          data: {
            client_action_id: crypto.randomUUID(),
            expected_state_version: session.state_version,
            action_type: 'SUBMIT_FINAL_ANSWER',
            payload: { value: '12' },
          },
        },
      );
      expect(
        mutate.status(),
        `${intruder} mutated ${owner}'s session: ${await responseSummary(mutate)}`,
      ).toBe(404);
    }
  }
}
