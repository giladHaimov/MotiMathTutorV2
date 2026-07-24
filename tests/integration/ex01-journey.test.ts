import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { makeApp, registerUser, newUuid, type TestUser } from '../helpers/app.js';
import { closePool, db } from '../../apps/api/src/db/index.js';
import { learningEvents, stageAttempts } from '../../apps/api/src/db/schema/product.js';
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
): Promise<{ status: number; body: PublicSession; raw: string }> {
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
  return { status: res.statusCode, body: res.json() as PublicSession, raw: res.body };
}

describe('EX-01 percentage journey (real API + PostgreSQL)', () => {
  it('completes EX-01 to result 12 with commitments, events, and reveal (AC-024/033/034/036)', async () => {
    const user = await registerUser(app);
    let session = await startSession(user);
    expect(session.visible_chunks).toHaveLength(1);
    expect(session.allowed_actions).toContain('ASSIGN_SLOT');
    expect(session.allowed_actions).not.toContain('SUBMIT_FINAL_ANSWER');

    ({ body: session } = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'WHOLE',
      token_id: 'ex01-c0-whole',
    }));
    expect(session.state_version).toBe(1);
    expect(session.visible_chunks).toHaveLength(1);
    expect(session.allowed_actions).toContain('SUBMIT_COMMITMENT');

    ({ body: session } = await act(user, session, 'SUBMIT_COMMITMENT', {}));
    expect(session.visible_chunks.map((c) => c.order_index)).toEqual([0, 1]);
    expect(session.accepted_commitments).toEqual(['WHOLE_IDENTIFIED']);

    ({ body: session } = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'PART_IN_PERCENTAGE',
      token_id: 'ex01-c1-percent',
    }));
    ({ body: session } = await act(user, session, 'SUBMIT_COMMITMENT', {}));
    expect(session.visible_chunks.map((c) => c.order_index)).toEqual([0, 1, 2]);
    expect(session.accepted_commitments).toEqual([
      'WHOLE_IDENTIFIED',
      'PART_PERCENTAGE_IDENTIFIED',
    ]);

    ({ body: session } = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'UNKNOWN',
      token_id: 'ex01-c2-unknown',
    }));
    expect(session.allowed_actions).toContain('SUBMIT_FINAL_ANSWER');
    expect(session.required_next_action).toEqual({ action_type: 'SUBMIT_FINAL_ANSWER' });

    ({ body: session } = await act(user, session, 'SUBMIT_FINAL_ANSWER', { value: '12' }));
    expect(session.status).toBe('COMPLETED');
    expect(session.allowed_actions).toEqual([]);

    const events = await db
      .select()
      .from(learningEvents)
      .where(eq(learningEvents.sessionId, session.session_id));
    expect(events.some((e) => e.eventType === 'COMMITMENT_ACCEPTED')).toBe(true);
    expect(events.some((e) => e.eventType === 'SESSION_COMPLETED')).toBe(true);

    const attempts = await db
      .select()
      .from(stageAttempts)
      .where(eq(stageAttempts.sessionId, session.session_id));
    expect(attempts.filter((a) => a.outcome === 'ACCEPTED').length).toBeGreaterThanOrEqual(6);
  });

  it('rejects 30%→WHOLE without advancing state; chunk 2 stays hidden (AC-012/025/027)', async () => {
    const user = await registerUser(app);
    let session = await startSession(user);
    ({ body: session } = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'WHOLE',
      token_id: 'ex01-c0-whole',
    }));
    ({ body: session } = await act(user, session, 'SUBMIT_COMMITMENT', {}));
    // Free WHOLE so the invalid pairing (not occupied-slot) is exercised.
    ({ body: session } = await act(user, session, 'DELETE_ASSIGNMENT', { slot: 'WHOLE' }));
    const versionBefore = session.state_version;
    expect(session.visible_chunks).toHaveLength(2);

    const rejected = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'WHOLE',
      token_id: 'ex01-c1-percent',
    });
    expect(rejected.status).toBe(200);
    expect(rejected.body.state_version).toBe(versionBefore);
    expect(rejected.body.message).toMatch(/structurally invalid|cannot be placed/i);
    expect(rejected.body.visible_chunks).toHaveLength(2);
    expect(rejected.raw).not.toContain('How many students');
    expect(rejected.body.workspace.slots.find((s) => s.slot === 'WHOLE')?.token_id).toBeNull();

    const attempts = await db
      .select()
      .from(stageAttempts)
      .where(eq(stageAttempts.sessionId, session.session_id));
    expect(attempts.some((a) => a.misconceptionCode === 'WHOLE_PART_CONFUSION')).toBe(true);
  });

  it('occupied-slot conflict requires explicit delete before progress (AC-026)', async () => {
    const user = await registerUser(app);
    let session = await startSession(user);
    ({ body: session } = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'WHOLE',
      token_id: 'ex01-c0-whole',
    }));
    const blocked = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'WHOLE',
      token_id: 'ex01-c0-whole',
    });
    expect(blocked.body.state_version).toBe(session.state_version);
    expect(blocked.body.message).toMatch(/delete/i);

    ({ body: session } = await act(user, session, 'DELETE_ASSIGNMENT', { slot: 'WHOLE' }));
    expect(session.workspace.slots.find((s) => s.slot === 'WHOLE')?.token_id).toBeNull();

    ({ body: session } = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'WHOLE',
      token_id: 'ex01-c0-whole',
    }));
    expect(session.workspace.slots.find((s) => s.slot === 'WHOLE')?.token_id).toBe('ex01-c0-whole');
  });

  it('final answer submitted early is unavailable (AC-033)', async () => {
    const user = await registerUser(app);
    const session = await startSession(user);
    const early = await act(user, session, 'SUBMIT_FINAL_ANSWER', { value: '12' });
    expect(early.body.status).toBe('ACTIVE');
    expect(early.body.state_version).toBe(session.state_version);
    expect(early.body.message).toMatch(/not available/i);
  });

  it('wrong numeric answer does not complete (AC-035)', async () => {
    const user = await registerUser(app);
    let session = await startSession(user);
    ({ body: session } = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'WHOLE',
      token_id: 'ex01-c0-whole',
    }));
    ({ body: session } = await act(user, session, 'SUBMIT_COMMITMENT', {}));
    ({ body: session } = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'PART_IN_PERCENTAGE',
      token_id: 'ex01-c1-percent',
    }));
    ({ body: session } = await act(user, session, 'SUBMIT_COMMITMENT', {}));
    ({ body: session } = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'UNKNOWN',
      token_id: 'ex01-c2-unknown',
    }));

    const wrong = await act(user, session, 'SUBMIT_FINAL_ANSWER', { value: '99' });
    expect(wrong.body.status).toBe('ACTIVE');
    expect(wrong.body.state_version).toBe(session.state_version);
  });

  it('resume mid-journey returns exact reveal/workspace at each stage (AC-049)', async () => {
    const user = await registerUser(app);
    let session = await startSession(user);
    ({ body: session } = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'WHOLE',
      token_id: 'ex01-c0-whole',
    }));
    ({ body: session } = await act(user, session, 'SUBMIT_COMMITMENT', {}));
    ({ body: session } = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'PART_IN_PERCENTAGE',
      token_id: 'ex01-c1-percent',
    }));

    const resumed = await authed(user, {
      method: 'GET',
      url: `/api/sessions/${session.session_id}`,
    });
    expect(resumed.statusCode).toBe(200);
    const body = resumed.json() as PublicSession;
    expect(body.state_version).toBe(session.state_version);
    expect(body.visible_chunks.map((c) => c.order_index)).toEqual([0, 1]);
    expect(body.workspace.slots.find((s) => s.slot === 'WHOLE')?.token_id).toBe('ex01-c0-whole');
    expect(body.workspace.slots.find((s) => s.slot === 'PART_IN_PERCENTAGE')?.token_id).toBe(
      'ex01-c1-percent',
    );
    expect(body.accepted_commitments).toEqual(['WHOLE_IDENTIFIED']);
    expect(resumed.body).not.toContain('How many students');
  });
});
