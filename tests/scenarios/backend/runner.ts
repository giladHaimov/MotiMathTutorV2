import { randomUUID } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { InjectOptions } from 'light-my-request';
import { eq, max } from 'drizzle-orm';
import type { PublicSession } from '@app/contracts';
import { makeApp, uniqueTestIp } from '../../helpers/app.js';
import { closePool, db } from '../../../apps/api/src/db/index.js';
import {
  chunks,
  learningEvents,
  learningSessions,
  problems,
  rollbackRules,
  rollbackLogs,
  stageAttempts,
} from '../../../apps/api/src/db/schema/product.js';
import { setPostAcceptWriteHook } from '../../../apps/api/src/modules/sessions/test-hooks.js';
import type { Scenario, ScenarioStep, SessionRef, UserRef } from '../catalog.js';

interface RuntimeUser {
  email: string;
  password: string;
  ip: string;
  cookie: string;
}

interface LastResult {
  response: LightMyRequestResponse;
  before: PublicSession | null;
  session: PublicSession | null;
  clientActionId: string | null;
}

const fullProblemTexts = [
  'A class has 40 students. Thirty percent wear glasses. How many students wear glasses?',
  'Red and blue marbles are in the ratio 2:3. There are 15 blue marbles. How many red marbles are there?',
  'Dana read three fifths of a 50-page booklet. How many pages remain unread?',
] as const;

function stepError(scenario: Scenario, index: number, message: string): never {
  throw new Error(`${scenario.id} step ${index + 1} (${scenario.steps[index]!.type}): ${message}`);
}

function parseBody(response: LightMyRequestResponse): unknown {
  if (!response.body) return null;
  try {
    return response.json();
  } catch {
    return response.body;
  }
}

function isSession(value: unknown): value is PublicSession {
  return (
    typeof value === 'object' &&
    value !== null &&
    'session_id' in value &&
    'state_version' in value &&
    'visible_chunks' in value
  );
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

function publicSessionFrom(response: LightMyRequestResponse): PublicSession | null {
  const body = parseBody(response);
  if (isSession(body)) return body;
  if (typeof body === 'object' && body !== null && 'current_state' in body) {
    const current = (body as { current_state?: unknown }).current_state;
    return isSession(current) ? current : null;
  }
  return null;
}

function problemKey(session: PublicSession): string {
  const token = session.visible_chunks[0]?.tokens[0]?.token_id ?? '';
  if (token.startsWith('ex01-')) return 'EX-01';
  if (token.startsWith('ex02-')) return 'EX-02';
  if (token.startsWith('ex03-')) return 'EX-03';
  if (token.startsWith('ex04-')) return 'EX-04';
  return 'UNKNOWN';
}

function assertNoFutureContent(
  scenario: Scenario,
  index: number,
  response: LightMyRequestResponse,
): void {
  const body = parseBody(response);
  if (typeof body !== 'object' || body === null) return;
  const serialized = JSON.stringify(body);
  for (const forbiddenKey of ['full_text', 'fullText', '"definition"', 'expected_final_result']) {
    if (serialized.includes(forbiddenKey)) {
      stepError(scenario, index, `response exposed forbidden server-only field ${forbiddenKey}`);
    }
  }
  const session = publicSessionFrom(response);
  if (!session) return;
  const indexes = session.visible_chunks.map((chunk) => chunk.order_index);
  const expected = Array.from({ length: indexes.length }, (_, i) => i);
  if (JSON.stringify(indexes) !== JSON.stringify(expected)) {
    stepError(
      scenario,
      index,
      `visible chunk indexes ${JSON.stringify(indexes)}, expected ${JSON.stringify(expected)}`,
    );
  }
  for (const fullText of fullProblemTexts) {
    if (serialized.includes(fullText))
      stepError(scenario, index, 'response exposed full problem text');
  }
}

export class ScenarioRunner {
  private app!: FastifyInstance;
  private readonly users = new Map<UserRef, RuntimeUser>();
  private readonly sessions = new Map<string, PublicSession>();
  private readonly actionIds = new Map<string, string>();
  private readonly responses: LightMyRequestResponse[] = [];
  private last: LastResult | null = null;
  private activation: { oldProblemId: string; newProblemId: string; newVersion: number } | null =
    null;

  async run(scenario: Scenario): Promise<void> {
    this.app = await makeApp();
    try {
      for (let index = 0; index < scenario.steps.length; index += 1) {
        await this.execute(scenario, index, scenario.steps[index]!);
        if (this.last) assertNoFutureContent(scenario, index, this.last.response);
        if (scenario.id === 'JS-03' && this.users.size === 2) {
          await this.assertCrossUserIsolation(scenario, index);
        }
      }
    } finally {
      setPostAcceptWriteHook(null);
      if (this.activation) {
        await db
          .update(problems)
          .set({ status: 'ACTIVE' })
          .where(eq(problems.id, this.activation.oldProblemId));
        await db
          .update(problems)
          .set({ status: 'RETIRED' })
          .where(eq(problems.id, this.activation.newProblemId));
      }
      await this.app.close();
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

  private async inject(
    scenario: Scenario,
    index: number,
    userRef: UserRef,
    options: InjectOptions | string,
  ): Promise<LightMyRequestResponse> {
    const user = this.getUser(scenario, index, userRef);
    const normalized = typeof options === 'string' ? { url: options } : options;
    const response = await this.app.inject({
      ...normalized,
      headers: {
        ...(user.cookie ? { cookie: user.cookie } : {}),
        'x-forwarded-for': user.ip,
        ...(normalized.headers ?? {}),
      },
    });
    this.responses.push(response);
    return response;
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
        for (const response of this.responses) assertNoFutureContent(scenario, index, response);
        return;
      case 'restartBackend':
        return this.restartBackend(scenario, index, step);
      case 'activateContentVersion':
        return this.activateContentVersion(scenario, index, step.session);
      case 'assertDbRows':
        return this.assertDbRows(scenario, index, step);
      case 'concurrent':
        return this.concurrent(scenario, index, step);
    }
  }

  private async register(scenario: Scenario, index: number, ref: UserRef): Promise<void> {
    const email = `${scenario.id.toLowerCase()}-${ref}-${randomUUID()}@example.com`;
    const password = `T9!${randomUUID()}`;
    const ip = uniqueTestIp(email);
    const response = await this.app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { 'x-forwarded-for': ip },
      payload: { email, password, name: `${scenario.id} ${ref}` },
    });
    this.responses.push(response);
    if (response.statusCode !== 200) {
      stepError(scenario, index, `registration returned ${response.statusCode}: ${response.body}`);
    }
    const cookie = response.cookies.map((item) => `${item.name}=${item.value}`).join('; ');
    if (!cookie) stepError(scenario, index, 'registration returned no Better Auth cookie');
    this.users.set(ref, { email, password, ip, cookie });
    this.last = { response, before: null, session: null, clientActionId: null };
  }

  private async login(
    scenario: Scenario,
    index: number,
    ref: UserRef,
    wrongPassword: boolean,
  ): Promise<void> {
    const user = this.getUser(scenario, index, ref);
    const response = await this.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { 'x-forwarded-for': user.ip },
      payload: {
        email: user.email,
        password: wrongPassword ? `${user.password}-wrong` : user.password,
      },
    });
    this.responses.push(response);
    if (wrongPassword) {
      if (response.statusCode < 400 || response.statusCode >= 500) {
        stepError(scenario, index, `wrong password returned ${response.statusCode}`);
      }
    } else {
      if (response.statusCode !== 200) {
        stepError(scenario, index, `login returned ${response.statusCode}: ${response.body}`);
      }
      user.cookie = response.cookies.map((item) => `${item.name}=${item.value}`).join('; ');
      if (!user.cookie) stepError(scenario, index, 'login returned no cookie');
    }
    this.last = { response, before: null, session: null, clientActionId: null };
  }

  private async logout(scenario: Scenario, index: number, ref: UserRef): Promise<void> {
    const response = await this.inject(scenario, index, ref, {
      method: 'POST',
      url: '/api/auth/sign-out',
      payload: {},
    });
    if (response.statusCode !== 200)
      stepError(scenario, index, `logout returned ${response.statusCode}`);
    this.getUser(scenario, index, ref).cookie = '';
    this.last = { response, before: null, session: null, clientActionId: null };
  }

  private async startSession(
    scenario: Scenario,
    index: number,
    step: Extract<ScenarioStep, { type: 'startSession' }>,
  ): Promise<void> {
    const user = step.user ?? 'primary';
    const prior = step.expectSameAs
      ? this.getSession(scenario, index, step.expectSameAs, user)
      : null;
    const response = await this.inject(scenario, index, user, {
      method: 'POST',
      url: '/api/sessions',
    });
    if (response.statusCode !== 201) {
      stepError(scenario, index, `start returned ${response.statusCode}: ${response.body}`);
    }
    const session = publicSessionFrom(response);
    if (!session) stepError(scenario, index, 'start returned no public session');
    if (problemKey(session) !== step.expectedProblem) {
      stepError(
        scenario,
        index,
        `started ${problemKey(session)}, expected ${step.expectedProblem}`,
      );
    }
    if (
      scenario.id === 'JS-16' &&
      user === 'secondary' &&
      this.activation &&
      session.content_version !== this.activation.newVersion
    ) {
      stepError(
        scenario,
        index,
        `fresh session pinned version ${session.content_version}, expected ${this.activation.newVersion}`,
      );
    }
    if (prior && prior.session_id !== session.session_id) {
      stepError(
        scenario,
        index,
        `start created ${session.session_id}, expected active ${prior.session_id}`,
      );
    }
    this.storeSession(user, step.session, session);
    this.last = { response, before: prior, session, clientActionId: null };
  }

  private async submitAction(
    scenario: Scenario,
    index: number,
    step: Extract<ScenarioStep, { type: 'submitAction' }>,
  ): Promise<void> {
    const user = step.user ?? 'primary';
    const before = this.getSession(scenario, index, step.session, user);
    const idKey = `${scenario.id}:${step.clientActionKey ?? randomUUID()}`;
    const clientActionId =
      this.actionIds.get(idKey) ?? (step.clientActionKey ? randomUUID() : idKey.split(':').at(-1)!);
    this.actionIds.set(idKey, clientActionId);
    const payload = {
      client_action_id: clientActionId,
      expected_state_version: Math.max(0, before.state_version - (step.staleBy ?? 0)),
      action_type: step.actionType,
      payload: step.payload,
    };
    if (step.injectFailure) {
      setPostAcceptWriteHook(() => {
        throw new Error('scenario injected transaction failure');
      });
    }
    const response = await this.inject(scenario, index, user, {
      method: 'POST',
      url: `/api/sessions/${before.session_id}/actions`,
      payload,
    });
    setPostAcceptWriteHook(null);
    let session = publicSessionFrom(response);
    if (step.duplicate) {
      const replay = await this.inject(scenario, index, user, {
        method: 'POST',
        url: `/api/sessions/${before.session_id}/actions`,
        payload,
      });
      const replaySession = publicSessionFrom(replay);
      if (
        response.statusCode !== replay.statusCode ||
        canonicalJson(session) !== canonicalJson(replaySession)
      ) {
        stepError(
          scenario,
          index,
          `duplicate mismatch first=${response.statusCode}:${JSON.stringify(
            session,
          )} replay=${replay.statusCode}:${JSON.stringify(replaySession)}`,
        );
      }
      this.responses.push(replay);
    }
    if (session) this.storeSession(user, step.session, session);
    else session = before;
    this.last = { response, before, session, clientActionId };
  }

  private async expectState(
    scenario: Scenario,
    index: number,
    step: Extract<ScenarioStep, { type: 'expectState' }>,
  ): Promise<void> {
    const session = this.getSession(scenario, index, step.session);
    const checks: Array<[boolean, string]> = [
      [
        step.status === undefined || session.status === step.status,
        `status ${session.status}, expected ${step.status}`,
      ],
      [
        step.visibleCount === undefined || session.visible_chunks.length === step.visibleCount,
        `visible count ${session.visible_chunks.length}, expected ${step.visibleCount}`,
      ],
      [
        step.stateVersion === undefined || session.state_version === step.stateVersion,
        `state version ${session.state_version}, expected ${step.stateVersion}`,
      ],
      [
        step.stateVersionAtLeast === undefined || session.state_version >= step.stateVersionAtLeast,
        `state version ${session.state_version}, expected >= ${step.stateVersionAtLeast}`,
      ],
      [
        step.requiredAction === undefined ||
          session.required_next_action.action_type === step.requiredAction,
        `required action ${session.required_next_action.action_type}, expected ${step.requiredAction}`,
      ],
      [
        step.guidanceCode === undefined || session.guidance_code === step.guidanceCode,
        `guidance ${session.guidance_code}, expected ${step.guidanceCode}`,
      ],
    ];
    if (step.slot) {
      const actual = session.workspace.slots.find(
        (slot) => slot.slot === step.slot!.name,
      )?.token_id;
      checks.push([
        actual === step.slot.tokenId,
        `slot ${step.slot.name}=${actual}, expected ${step.slot.tokenId}`,
      ]);
    }
    const failed = checks.find(([ok]) => !ok);
    if (failed) stepError(scenario, index, failed[1]);
  }

  private async expectRejected(
    scenario: Scenario,
    index: number,
    step: Extract<ScenarioStep, { type: 'expectRejected' }>,
  ): Promise<void> {
    if (
      !this.last ||
      (step.statusCode !== undefined && this.last.response.statusCode !== step.statusCode)
    ) {
      const session = this.getSession(scenario, index, step.session);
      const response = await this.inject(scenario, index, 'primary', {
        method: 'GET',
        url: `/api/sessions/${session.session_id}`,
      });
      this.last = {
        response,
        before: session,
        session: publicSessionFrom(response),
        clientActionId: null,
      };
    }
    if (step.statusCode !== undefined && this.last.response.statusCode !== step.statusCode) {
      stepError(
        scenario,
        index,
        `status ${this.last.response.statusCode}, expected ${step.statusCode}`,
      );
    }
    if (step.stateUnchanged && this.last.before && this.last.session) {
      if (this.last.before.state_version !== this.last.session.state_version) {
        stepError(
          scenario,
          index,
          `rejected action changed state ${this.last.before.state_version}→${this.last.session.state_version}`,
        );
      }
    }
    if (step.misconception) {
      const session = this.getSession(scenario, index, step.session);
      const rows = await db
        .select()
        .from(stageAttempts)
        .where(eq(stageAttempts.sessionId, session.session_id));
      if (!rows.some((row) => row.misconceptionCode === step.misconception)) {
        stepError(scenario, index, `no attempt recorded misconception ${step.misconception}`);
      }
    }
  }

  private async restartBackend(
    scenario: Scenario,
    index: number,
    step: Extract<ScenarioStep, { type: 'restartBackend' }>,
  ): Promise<void> {
    const user = step.user ?? 'primary';
    const before = this.getSession(scenario, index, step.session, user);
    await this.app.close();
    await closePool();
    this.app = await makeApp();
    const response = await this.inject(scenario, index, user, {
      method: 'GET',
      url: `/api/sessions/${before.session_id}`,
    });
    if (response.statusCode !== 200)
      stepError(scenario, index, `resume returned ${response.statusCode}`);
    const session = publicSessionFrom(response)!;
    if (
      session.state_version !== before.state_version ||
      JSON.stringify(session.workspace) !== JSON.stringify(before.workspace) ||
      JSON.stringify(session.visible_chunks) !== JSON.stringify(before.visible_chunks)
    ) {
      stepError(scenario, index, 'restart did not resume exact authoritative state');
    }
    this.storeSession(user, step.session, session);
    this.last = { response, before, session, clientActionId: null };
  }

  private async assertPinnedVersion(
    scenario: Scenario,
    index: number,
    sessionRef: SessionRef,
  ): Promise<void> {
    const session = this.getSession(scenario, index, sessionRef);
    const [row] = await db
      .select({
        engineVersion: learningSessions.engineVersion,
        contentVersion: learningSessions.contentVersion,
      })
      .from(learningSessions)
      .where(eq(learningSessions.id, session.session_id));
    if (
      !row ||
      row.engineVersion !== session.engine_version ||
      row.contentVersion !== session.content_version
    ) {
      stepError(scenario, index, 'durable pinned versions differ from public authoritative state');
    }
  }

  private async activateContentVersion(
    scenario: Scenario,
    index: number,
    sessionRef: SessionRef,
  ): Promise<void> {
    const session = this.getSession(scenario, index, sessionRef);
    const [sessionRow] = await db
      .select({ problemId: learningSessions.problemId })
      .from(learningSessions)
      .where(eq(learningSessions.id, session.session_id));
    if (!sessionRow) stepError(scenario, index, 'active session row is missing');
    const [oldProblem] = await db
      .select()
      .from(problems)
      .where(eq(problems.id, sessionRow.problemId));
    if (!oldProblem) stepError(scenario, index, 'pinned problem row is missing');
    const [versionRow] = await db
      .select({ value: max(problems.version) })
      .from(problems)
      .where(eq(problems.problemKey, oldProblem.problemKey));
    const newVersion = (versionRow?.value ?? oldProblem.version) + 1;
    const [created] = await db
      .insert(problems)
      .values({
        programId: oldProblem.programId,
        problemKey: oldProblem.problemKey,
        version: newVersion,
        domain: oldProblem.domain,
        title: `${oldProblem.title} scenario version ${newVersion}`,
        difficultyLevel: oldProblem.difficultyLevel,
        fullText: oldProblem.fullText,
        definition: oldProblem.definition,
        status: 'ACTIVE',
      })
      .returning({ id: problems.id });
    if (!created) stepError(scenario, index, 'failed to create activated problem version');

    const sourceChunks = await db.select().from(chunks).where(eq(chunks.problemId, oldProblem.id));
    await db.insert(chunks).values(
      sourceChunks.map((chunk) => ({
        problemId: created.id,
        orderIndex: chunk.orderIndex,
        chunkType: chunk.chunkType,
        content: chunk.content,
        semanticDefinition: chunk.semanticDefinition,
      })),
    );
    const sourceRules = await db
      .select()
      .from(rollbackRules)
      .where(eq(rollbackRules.problemId, oldProblem.id));
    if (sourceRules.length > 0) {
      await db.insert(rollbackRules).values(
        sourceRules.map((rule) => ({
          problemId: created.id,
          misconceptionCode: rule.misconceptionCode,
          repeatFrom: rule.repeatFrom,
          rollbackDepth: rule.rollbackDepth,
          guidanceCode: rule.guidanceCode,
        })),
      );
    }
    await db.update(problems).set({ status: 'RETIRED' }).where(eq(problems.id, oldProblem.id));
    this.activation = {
      oldProblemId: oldProblem.id,
      newProblemId: created.id,
      newVersion,
    };
    await this.assertPinnedVersion(scenario, index, sessionRef);
  }

  private async assertDbRows(
    scenario: Scenario,
    index: number,
    step: Extract<ScenarioStep, { type: 'assertDbRows' }>,
  ): Promise<void> {
    const session = this.getSession(scenario, index, step.session);
    const attempts = await db
      .select()
      .from(stageAttempts)
      .where(eq(stageAttempts.sessionId, session.session_id));
    const events = await db
      .select()
      .from(learningEvents)
      .where(eq(learningEvents.sessionId, session.session_id));
    const rollbacks = await db
      .select()
      .from(rollbackLogs)
      .where(eq(rollbackLogs.sessionId, session.session_id));
    if (step.attemptsAtLeast !== undefined && attempts.length < step.attemptsAtLeast) {
      stepError(
        scenario,
        index,
        `attempt rows ${attempts.length}, expected >= ${step.attemptsAtLeast}`,
      );
    }
    if (step.eventsAtLeast !== undefined && events.length < step.eventsAtLeast) {
      stepError(scenario, index, `event rows ${events.length}, expected >= ${step.eventsAtLeast}`);
    }
    if (step.rollbackLogs !== undefined && rollbacks.length !== step.rollbackLogs) {
      stepError(
        scenario,
        index,
        `rollback rows ${rollbacks.length}, expected ${step.rollbackLogs}`,
      );
    }
    if (step.attemptsExactlyForLastAction !== undefined && this.last?.clientActionId) {
      const count = attempts.filter(
        (row) => row.clientActionId === this.last!.clientActionId,
      ).length;
      if (count !== step.attemptsExactlyForLastAction) {
        stepError(
          scenario,
          index,
          `last-action attempts ${count}, expected ${step.attemptsExactlyForLastAction}`,
        );
      }
    }
    if (step.pseudonymousVersions) {
      if (
        events.some(
          (event) =>
            !event.analyticsSubjectId || !event.engineVersion || event.contentVersion === null,
        )
      ) {
        stepError(scenario, index, 'learning event lacks pseudonymous subject/version fields');
      }
    }
    if (step.noSensitiveData) {
      const serialized = JSON.stringify({ attempts, events, rollbacks }).toLowerCase();
      const user = this.getUser(scenario, index);
      if (
        serialized.includes(user.email.toLowerCase()) ||
        serialized.includes(user.password.toLowerCase()) ||
        serialized.includes('better-auth.session')
      ) {
        stepError(scenario, index, 'learning tables contain sensitive auth data');
      }
    }
  }

  private async concurrent(
    scenario: Scenario,
    index: number,
    step: Extract<ScenarioStep, { type: 'concurrent' }>,
  ): Promise<void> {
    const userRef = step.user ?? 'primary';
    const session = this.getSession(scenario, index, step.session, userRef);
    const request = (action: (typeof step.actions)[number]) =>
      this.inject(scenario, index, userRef, {
        method: 'POST',
        url: `/api/sessions/${session.session_id}/actions`,
        payload: {
          client_action_id: randomUUID(),
          expected_state_version: session.state_version,
          action_type: action.actionType,
          payload: action.payload,
        },
      });
    const responses = await Promise.all(step.actions.map(request));
    const statuses = responses.map((response) => response.statusCode).sort();
    if (statuses[0] !== 200 || statuses[1] !== 409) {
      stepError(scenario, index, `concurrent statuses ${statuses.join(',')}, expected 200,409`);
    }
    const winner = responses.find((response) => response.statusCode === 200)!;
    const current = publicSessionFrom(winner)!;
    this.storeSession(userRef, step.session, current);
    this.last = { response: winner, before: session, session: current, clientActionId: null };
  }

  private async assertCrossUserIsolation(scenario: Scenario, index: number): Promise<void> {
    const primary = this.users.get('primary');
    const secondary = this.users.get('secondary');
    if (!primary || !secondary) return;
    for (const [key, session] of this.sessions) {
      const owner = key.startsWith('primary:')
        ? 'primary'
        : key.startsWith('secondary:')
          ? 'secondary'
          : null;
      if (!owner || key.endsWith(':current')) continue;
      const intruder: UserRef = owner === 'primary' ? 'secondary' : 'primary';
      const response = await this.inject(scenario, index, intruder, {
        method: 'GET',
        url: `/api/sessions/${session.session_id}`,
      });
      if (response.statusCode !== 404) {
        stepError(scenario, index, `${intruder} read ${owner}'s session (${response.statusCode})`);
      }
    }
  }
}
