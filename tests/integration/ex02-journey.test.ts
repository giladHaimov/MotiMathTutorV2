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

/** Complete EX-01 so the next deterministic problem is EX-02. */
async function completeEx01(user: TestUser, session: PublicSession): Promise<PublicSession> {
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
  return s;
}

describe('EX-02 ratio journey (real API + PostgreSQL)', () => {
  it('blocks premature numeric answer, requires ack, completes with 10 (AC-028/029/037)', async () => {
    const user = await registerUser(app);
    let session = await startSession(user);
    await completeEx01(user, session);

    session = await startSession(user);
    expect(session.visible_chunks).toHaveLength(1);
    expect(session.visible_chunks[0]?.content).toContain('ratio 2:3');
    expect(session.content_version).toBe(3);

    const premature = await act(user, session, 'SUBMIT_FINAL_ANSWER', { value: '10' });
    expect(premature.status).toBe(200);
    session = premature.body;
    expect(session.status).toBe('ACTIVE');
    expect(session.visible_chunks).toHaveLength(1);
    expect(session.message).toMatch(/insufficient/i);
    expect(session.allowed_actions).toContain('ACKNOWLEDGE_INSUFFICIENT_INFORMATION');
    expect(session.allowed_actions).not.toContain('ASSIGN_SLOT');
    expect(session.required_next_action).toEqual({
      action_type: 'ACKNOWLEDGE_INSUFFICIENT_INFORMATION',
    });

    const attempts = await db
      .select()
      .from(stageAttempts)
      .where(eq(stageAttempts.sessionId, session.session_id));
    expect(attempts.some((a) => a.misconceptionCode === 'PREMATURE_QUANTIFICATION')).toBe(true);

    // Bypass attempt while acknowledgment is required.
    const bypass = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'RATIO',
      token_id: 'ex02-c0-ratio',
    });
    expect(bypass.body.allowed_actions).toContain('ACKNOWLEDGE_INSUFFICIENT_INFORMATION');
    expect(bypass.body.visible_chunks).toHaveLength(1);
    session = bypass.body;

    ({ body: session } = await act(user, session, 'ACKNOWLEDGE_INSUFFICIENT_INFORMATION', {}));
    expect(session.allowed_actions).toContain('ASSIGN_SLOT');
    expect(session.allowed_actions).not.toContain('ACKNOWLEDGE_INSUFFICIENT_INFORMATION');

    const events = await db
      .select()
      .from(learningEvents)
      .where(eq(learningEvents.sessionId, session.session_id));
    expect(events.some((e) => e.eventType === 'PREMATURE_COMMITMENT_BLOCKED')).toBe(true);
    expect(events.some((e) => e.eventType === 'INSUFFICIENT_INFORMATION_ACKNOWLEDGED')).toBe(true);

    ({ body: session } = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'RATIO',
      token_id: 'ex02-c0-ratio',
    }));
    ({ body: session } = await act(user, session, 'SUBMIT_COMMITMENT', {}));
    expect(session.visible_chunks.map((c) => c.order_index)).toEqual([0, 1]);

    ({ body: session } = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'PART_IN_NUMBER',
      token_id: 'ex02-c1-blue',
    }));
    ({ body: session } = await act(user, session, 'SUBMIT_COMMITMENT', {}));
    ({ body: session } = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'UNKNOWN',
      token_id: 'ex02-c2-unknown',
    }));
    ({ body: session } = await act(user, session, 'SUBMIT_FINAL_ANSWER', { value: '10' }));
    expect(session.status).toBe('COMPLETED');
    expect(session.content_version).toBe(3);
  });

  it('EX-02 sessions persist and return content_version = 3 (problem version)', async () => {
    const user = await registerUser(app);
    let session = await startSession(user);
    await completeEx01(user, session);
    session = await startSession(user);
    expect(session.content_version).toBe(3);

    const [row] = await db
      .select({
        contentVersion: learningSessions.contentVersion,
        problemId: learningSessions.problemId,
      })
      .from(learningSessions)
      .where(eq(learningSessions.id, session.session_id));
    expect(row!.contentVersion).toBe(2);

    const [problem] = await db
      .select({ version: problems.version, problemKey: problems.problemKey })
      .from(problems)
      .where(eq(problems.id, row!.problemId));
    expect(problem!.problemKey).toBe('EX-02');
    expect(problem!.version).toBe(3);

    const resumed = await authed(user, {
      method: 'GET',
      url: `/api/sessions/${session.session_id}`,
    });
    expect((resumed.json() as PublicSession).content_version).toBe(3);
  });

  it('resumes while acknowledgment is pending (blocked state)', async () => {
    const user = await registerUser(app);
    let session = await startSession(user);
    await completeEx01(user, session);
    session = await startSession(user);

    ({ body: session } = await act(user, session, 'SUBMIT_FINAL_ANSWER', { value: '4' }));
    expect(session.allowed_actions).toContain('ACKNOWLEDGE_INSUFFICIENT_INFORMATION');
    const version = session.state_version;

    const resumed = await authed(user, {
      method: 'GET',
      url: `/api/sessions/${session.session_id}`,
    });
    expect(resumed.statusCode).toBe(200);
    const body = resumed.json() as PublicSession;
    expect(body.state_version).toBe(version);
    expect(body.allowed_actions).toContain('ACKNOWLEDGE_INSUFFICIENT_INFORMATION');
    expect(body.message).toMatch(/insufficient/i);
    expect(body.visible_chunks).toHaveLength(1);
  });
});
