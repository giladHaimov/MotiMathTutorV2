import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { makeApp, registerUser, newUuid, type TestUser } from '../helpers/app.js';
import { closePool, db } from '../../apps/api/src/db/index.js';
import {
  learningEvents,
  learningSessions,
  problems,
  stageAttempts,
} from '../../apps/api/src/db/schema/product.js';
import type { ActionType, PublicSession } from '@app/contracts';

let app: FastifyInstance;

beforeAll(async () => {
  app = await makeApp();
});
afterAll(async () => {
  await app.close();
  await closePool();
});

function authed(user: TestUser, opts: Parameters<FastifyInstance['inject']>[0]) {
  const o = typeof opts === 'string' ? { url: opts } : opts;
  return app.inject({ ...o, headers: { cookie: user.cookie, ...(o.headers ?? {}) } });
}

async function startSession(user: TestUser): Promise<PublicSession> {
  const res = await authed(user, { method: 'POST', url: '/api/sessions' });
  expect(res.statusCode).toBe(201);
  return res.json() as PublicSession;
}

async function act(
  user: TestUser,
  session: PublicSession,
  action_type: ActionType,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: PublicSession }> {
  const res = await authed(user, {
    method: 'POST',
    url: `/api/sessions/${session.session_id}/actions`,
    payload: {
      client_action_id: newUuid(),
      expected_state_version: session.state_version,
      action_type,
      payload,
    },
  });
  return { status: res.statusCode, body: res.json() as PublicSession };
}

async function completeEx01(user: TestUser, session: PublicSession): Promise<void> {
  let s = session;
  ({ body: s } = await act(user, s, 'ASSIGN_SLOT', {
    slot: 'WHOLE',
    token_id: 'ex01-c0-whole',
  }));
  ({ body: s } = await act(user, s, 'SUBMIT_COMMITMENT', {}));
  ({ body: s } = await act(user, s, 'ASSIGN_SLOT', {
    slot: 'PART_IN_PERCENTAGE',
    token_id: 'ex01-c1-percent',
  }));
  ({ body: s } = await act(user, s, 'SUBMIT_COMMITMENT', {}));
  ({ body: s } = await act(user, s, 'ASSIGN_SLOT', {
    slot: 'UNKNOWN',
    token_id: 'ex01-c2-unknown',
  }));
  ({ body: s } = await act(user, s, 'SUBMIT_FINAL_ANSWER', { value: '12' }));
  expect(s.status).toBe('COMPLETED');
}

async function completeEx02(user: TestUser, session: PublicSession): Promise<void> {
  let s = session;
  ({ body: s } = await act(user, s, 'ASSIGN_SLOT', {
    slot: 'RATIO',
    token_id: 'ex02-c0-ratio',
  }));
  ({ body: s } = await act(user, s, 'SUBMIT_COMMITMENT', {}));
  ({ body: s } = await act(user, s, 'ASSIGN_SLOT', {
    slot: 'PART_IN_NUMBER',
    token_id: 'ex02-c1-blue',
  }));
  ({ body: s } = await act(user, s, 'SUBMIT_COMMITMENT', {}));
  ({ body: s } = await act(user, s, 'ASSIGN_SLOT', {
    slot: 'UNKNOWN',
    token_id: 'ex02-c2-unknown',
  }));
  ({ body: s } = await act(user, s, 'SUBMIT_FINAL_ANSWER', { value: '10' }));
  expect(s.status).toBe('COMPLETED');
}

/** EX-04 is difficulty 2 and sorts before EX-03 (difficulty 3). Complete it too. */
async function completeEx04(user: TestUser, session: PublicSession): Promise<void> {
  let s = session;
  // EX-04 uses EX-01 content pattern (same percentage problem structure).
  ({ body: s } = await act(user, s, 'ASSIGN_SLOT', {
    slot: 'WHOLE',
    token_id: 'ex04-c0-whole',
  }));
  ({ body: s } = await act(user, s, 'SUBMIT_COMMITMENT', {}));
  ({ body: s } = await act(user, s, 'ASSIGN_SLOT', {
    slot: 'PART_IN_PERCENTAGE',
    token_id: 'ex04-c1-percent',
  }));
  ({ body: s } = await act(user, s, 'SUBMIT_COMMITMENT', {}));
  ({ body: s } = await act(user, s, 'ASSIGN_SLOT', {
    slot: 'UNKNOWN',
    token_id: 'ex04-c2-unknown',
  }));
  ({ body: s } = await act(user, s, 'SUBMIT_FINAL_ANSWER', { value: '12' }));
  expect(s.status).toBe('COMPLETED');
}

describe('EX-03 fraction journey (real API + PostgreSQL)', () => {
  it('blocks early calc, rejects complement confusion, completes with 20 (AC-028/038)', async () => {
    const user = await registerUser(app);
    let session = await startSession(user);
    await completeEx01(user, session);

    session = await startSession(user);
    await completeEx02(user, session);

    session = await startSession(user);
    // Next is EX-04 (difficulty 2) before EX-03 (difficulty 3).
    expect(session.visible_chunks[0]?.content).toMatch(/class has|40 students|EX-04|Thirty/i);
    await completeEx04(user, session);

    session = await startSession(user);
    expect(session.visible_chunks[0]?.content).toContain('three fifths');
    expect(session.content_version).toBe(3);

    const [row] = await db
      .select({
        contentVersion: learningSessions.contentVersion,
        problemId: learningSessions.problemId,
      })
      .from(learningSessions)
      .where(eq(learningSessions.id, session.session_id));
    expect(row!.contentVersion).toBe(3);
    const [problem] = await db
      .select({ version: problems.version, problemKey: problems.problemKey })
      .from(problems)
      .where(eq(problems.id, row!.problemId));
    expect(problem!.problemKey).toBe('EX-03');
    expect(problem!.version).toBe(3);

    ({ body: session } = await act(user, session, 'SUBMIT_FINAL_ANSWER', { value: '20' }));
    expect(session.visible_chunks).toHaveLength(1);
    expect(session.allowed_actions).toContain('ACKNOWLEDGE_INSUFFICIENT_INFORMATION');

    const attempts = await db
      .select()
      .from(stageAttempts)
      .where(eq(stageAttempts.sessionId, session.session_id));
    expect(attempts.some((a) => a.misconceptionCode === 'PREMATURE_QUANTIFICATION')).toBe(true);

    ({ body: session } = await act(user, session, 'ACKNOWLEDGE_INSUFFICIENT_INFORMATION', {}));
    ({ body: session } = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'FRACTION',
      token_id: 'ex03-c0-fraction',
    }));
    ({ body: session } = await act(user, session, 'SUBMIT_COMMITMENT', {}));
    expect(session.visible_chunks.map((c) => c.order_index)).toEqual([0, 1]);

    ({ body: session } = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'WHOLE',
      token_id: 'ex03-c1-whole',
    }));
    ({ body: session } = await act(user, session, 'SUBMIT_COMMITMENT', {}));
    expect(session.visible_chunks.map((c) => c.order_index)).toEqual([0, 1, 2]);

    // Invalid: treat read fraction as remaining (COMPLEMENT_CONFUSION).
    const complement = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'UNKNOWN',
      token_id: 'ex03-c0-fraction',
    });
    expect(complement.body.completed_steps.some((s) => s.correct_slot === 'UNKNOWN')).toBe(false);
    session = complement.body;

    const complementAttempts = await db
      .select()
      .from(stageAttempts)
      .where(eq(stageAttempts.sessionId, session.session_id));
    expect(complementAttempts.some((a) => a.misconceptionCode === 'COMPLEMENT_CONFUSION')).toBe(
      true,
    );

    ({ body: session } = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'UNKNOWN',
      token_id: 'ex03-c2-unknown',
    }));
    ({ body: session } = await act(user, session, 'SUBMIT_FINAL_ANSWER', { value: '20' }));
    expect(session.status).toBe('COMPLETED');

    const events = await db
      .select()
      .from(learningEvents)
      .where(eq(learningEvents.sessionId, session.session_id));
    expect(events.some((e) => e.eventType === 'SESSION_COMPLETED')).toBe(true);
  });
});
