import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { makeApp, registerUser, newUuid, type TestUser } from '../helpers/app.js';
import { closePool, db } from '../../apps/api/src/db/index.js';
import {
  learningEvents,
  learningSessions,
  rollbackLogs,
  stageAttempts,
} from '../../apps/api/src/db/schema/product.js';
import { setPostAcceptWriteHook } from '../../apps/api/src/modules/sessions/test-hooks.js';
import type { ActionType, PublicSession } from '@app/contracts';

let app: FastifyInstance;

beforeAll(async () => {
  app = await makeApp();
});
afterEach(() => setPostAcceptWriteHook(null));
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
  clientActionId: string = newUuid(),
): Promise<{ status: number; body: PublicSession }> {
  const res = await authed(user, {
    method: 'POST',
    url: `/api/sessions/${session.session_id}/actions`,
    payload: {
      client_action_id: clientActionId,
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

/** Reach EX-04 (difficulty 2, after EX-01 and EX-02). */
async function startEx04(user: TestUser): Promise<PublicSession> {
  let session = await startSession(user);
  await completeEx01(user, session);
  session = await startSession(user);
  await completeEx02(user, session);
  session = await startSession(user);
  expect(session.visible_chunks[0]?.tokens.some((t) => t.token_id.startsWith('ex04-'))).toBe(true);
  return session;
}

describe('EX-04 conflict deletion + deterministic rollback (real API + PostgreSQL)', () => {
  it('blocks conflict until server delete; local-only clear does not unblock (AC-026/027)', async () => {
    const user = await registerUser(app);
    let session = await startEx04(user);

    // Place 40 in Part-in-number → rejected/classified (WHOLE_PART_CONFUSION).
    const wrongPart = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'PART_IN_NUMBER',
      token_id: 'ex04-c0-whole',
    });
    expect(wrongPart.status).toBe(200);
    expect(
      wrongPart.body.workspace.slots.find((s) => s.slot === 'PART_IN_NUMBER')?.token_id,
    ).toBeNull();
    session = wrongPart.body;

    const attempts = await db
      .select()
      .from(stageAttempts)
      .where(eq(stageAttempts.sessionId, session.session_id));
    expect(attempts.some((a) => a.misconceptionCode === 'WHOLE_PART_CONFUSION')).toBe(true);

    // Valid Whole + reveal chunk 1.
    ({ body: session } = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'WHOLE',
      token_id: 'ex04-c0-whole',
    }));
    ({ body: session } = await act(user, session, 'SUBMIT_COMMITMENT', {}));
    expect(session.visible_chunks).toHaveLength(2);

    // 30% → WHOLE while occupied → conflict remains (AC-026).
    const conflict = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'WHOLE',
      token_id: 'ex04-c1-percent',
    });
    expect(conflict.body.message).toMatch(/invalid|delete|occupied/i);
    expect(conflict.body.workspace.slots.find((s) => s.slot === 'WHOLE')?.token_id).toBe(
      'ex04-c0-whole',
    );
    expect(conflict.body.visible_chunks).toHaveLength(2);
    expect(conflict.body.guidance_code).toBeNull();
    session = conflict.body;

    // Local UI removal without server deletion cannot unblock: authoritative
    // resume still shows the conflicting occupancy (AC-026/027).
    const resumed = await authed(user, {
      method: 'GET',
      url: `/api/sessions/${session.session_id}`,
    });
    expect(resumed.statusCode).toBe(200);
    const resumedBody = resumed.json() as PublicSession;
    expect(resumedBody.workspace.slots.find((s) => s.slot === 'WHOLE')?.token_id).toBe(
      'ex04-c0-whole',
    );
    session = resumedBody;

    // Explicit server delete unblocks (PB-007).
    ({ body: session } = await act(user, session, 'DELETE_ASSIGNMENT', { slot: 'WHOLE' }));
    expect(session.workspace.slots.find((s) => s.slot === 'WHOLE')?.token_id).toBeNull();
  });

  it('second CONFLICTING_SLOT_ASSIGNMENT applies fixture rollback + log (AC-031/039/044)', async () => {
    const user = await registerUser(app);
    let session = await startEx04(user);

    ({ body: session } = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'WHOLE',
      token_id: 'ex04-c0-whole',
    }));
    ({ body: session } = await act(user, session, 'SUBMIT_COMMITMENT', {}));
    expect(session.visible_chunks).toHaveLength(2);

    // First equivalent error — no rollback yet.
    const first = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'WHOLE',
      token_id: 'ex04-c1-percent',
    });
    expect(first.body.guidance_code).toBeNull();
    expect(first.body.visible_chunks).toHaveLength(2);
    session = first.body;

    ({ body: session } = await act(user, session, 'DELETE_ASSIGNMENT', { slot: 'WHOLE' }));

    // Second equivalent error → deterministic rollback (repeat_from: 2, depth: 1).
    const second = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'WHOLE',
      token_id: 'ex04-c1-percent',
    });
    expect(second.status).toBe(200);
    expect(second.body.guidance_code).toBe('GUIDE_DELETE_CONFLICT');
    expect(second.body.message).toMatch(/delete|rebuild/i);
    expect(second.body.visible_chunks).toHaveLength(1);
    expect(second.body.accepted_commitments).toEqual([]);
    session = second.body;

    const logs = await db
      .select()
      .from(rollbackLogs)
      .where(eq(rollbackLogs.sessionId, session.session_id));
    expect(logs).toHaveLength(1);
    expect(logs[0]!.misconceptionCode).toBe('CONFLICTING_SLOT_ASSIGNMENT');
    expect(logs[0]!.fromChunkIndex).toBe(1);
    expect(logs[0]!.toChunkIndex).toBe(0);
    expect(logs[0]!.rollbackDepth).toBe(1);
    expect(logs[0]!.repeatCount).toBe(2);
    expect(logs[0]!.guidanceCode).toBe('GUIDE_DELETE_CONFLICT');

    const events = await db
      .select()
      .from(learningEvents)
      .where(eq(learningEvents.sessionId, session.session_id));
    expect(events.some((e) => e.eventType === 'ROLLBACK_APPLIED')).toBe(true);
    expect(events.some((e) => e.eventType === 'ACTION_REJECTED' && e.attemptId)).toBe(true);

    // Resume from rollback target and complete EX-04 (AC-039).
    ({ body: session } = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'WHOLE',
      token_id: 'ex04-c0-whole',
    }));
    ({ body: session } = await act(user, session, 'SUBMIT_COMMITMENT', {}));
    ({ body: session } = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'PART_IN_PERCENTAGE',
      token_id: 'ex04-c1-percent',
    }));
    ({ body: session } = await act(user, session, 'SUBMIT_COMMITMENT', {}));
    ({ body: session } = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'UNKNOWN',
      token_id: 'ex04-c2-unknown',
    }));
    ({ body: session } = await act(user, session, 'SUBMIT_FINAL_ANSWER', { value: '12' }));
    expect(session.status).toBe('COMPLETED');
  });

  it('duplicate client_action_id creates only one rollback (AC-032)', async () => {
    const user = await registerUser(app);
    let session = await startEx04(user);

    ({ body: session } = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'WHOLE',
      token_id: 'ex04-c0-whole',
    }));
    ({ body: session } = await act(user, session, 'SUBMIT_COMMITMENT', {}));
    ({ body: session } = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'WHOLE',
      token_id: 'ex04-c1-percent',
    }));
    ({ body: session } = await act(user, session, 'DELETE_ASSIGNMENT', { slot: 'WHOLE' }));

    const clientActionId = newUuid();
    const first = await act(
      user,
      session,
      'ASSIGN_SLOT',
      { slot: 'WHOLE', token_id: 'ex04-c1-percent' },
      clientActionId,
    );
    expect(first.body.guidance_code).toBe('GUIDE_DELETE_CONFLICT');
    const versionAfter = first.body.state_version;

    const replay = await act(
      user,
      first.body,
      'ASSIGN_SLOT',
      { slot: 'WHOLE', token_id: 'ex04-c1-percent' },
      clientActionId,
    );
    expect(replay.body.state_version).toBe(versionAfter);
    expect(replay.body.guidance_code).toBe('GUIDE_DELETE_CONFLICT');

    const logs = await db
      .select()
      .from(rollbackLogs)
      .where(eq(rollbackLogs.sessionId, session.session_id));
    expect(logs).toHaveLength(1);

    const rollbackAttempts = await db
      .select()
      .from(stageAttempts)
      .where(
        and(
          eq(stageAttempts.sessionId, session.session_id),
          eq(stageAttempts.clientActionId, clientActionId),
        ),
      );
    expect(rollbackAttempts).toHaveLength(1);
  });

  it('forced failure during rollback leaves no partial state or rollback_log (AC-020/021)', async () => {
    const user = await registerUser(app);
    let session = await startEx04(user);

    ({ body: session } = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'WHOLE',
      token_id: 'ex04-c0-whole',
    }));
    ({ body: session } = await act(user, session, 'SUBMIT_COMMITMENT', {}));
    ({ body: session } = await act(user, session, 'ASSIGN_SLOT', {
      slot: 'WHOLE',
      token_id: 'ex04-c1-percent',
    }));
    ({ body: session } = await act(user, session, 'DELETE_ASSIGNMENT', { slot: 'WHOLE' }));

    const versionBefore = session.state_version;
    const chunkBefore = session.visible_chunks.length;
    const clientActionId = newUuid();

    setPostAcceptWriteHook(() => {
      throw new Error('injected failure after rollback writes');
    });

    const failed = await authed(user, {
      method: 'POST',
      url: `/api/sessions/${session.session_id}/actions`,
      payload: {
        client_action_id: clientActionId,
        expected_state_version: session.state_version,
        action_type: 'ASSIGN_SLOT',
        payload: { slot: 'WHOLE', token_id: 'ex04-c1-percent' },
      },
    });
    expect(failed.statusCode).toBe(500);

    const after = (
      await db.select().from(learningSessions).where(eq(learningSessions.id, session.session_id))
    )[0]!;
    expect(after.stateVersion).toBe(versionBefore);
    expect(after.currentChunkIndex).toBe(chunkBefore - 1);

    const attempts = await db
      .select()
      .from(stageAttempts)
      .where(
        and(
          eq(stageAttempts.sessionId, session.session_id),
          eq(stageAttempts.clientActionId, clientActionId),
        ),
      );
    expect(attempts).toHaveLength(0);

    const logs = await db
      .select()
      .from(rollbackLogs)
      .where(eq(rollbackLogs.sessionId, session.session_id));
    expect(logs).toHaveLength(0);

    const rollbackEvents = await db
      .select()
      .from(learningEvents)
      .where(
        and(
          eq(learningEvents.sessionId, session.session_id),
          eq(learningEvents.eventType, 'ROLLBACK_APPLIED'),
        ),
      );
    expect(rollbackEvents).toHaveLength(0);

    // Recovery with the fault cleared applies the rollback once.
    setPostAcceptWriteHook(null);
    const ok = await act(
      user,
      session,
      'ASSIGN_SLOT',
      { slot: 'WHOLE', token_id: 'ex04-c1-percent' },
      clientActionId,
    );
    expect(ok.status).toBe(200);
    expect(ok.body.guidance_code).toBe('GUIDE_DELETE_CONFLICT');
    expect(ok.body.visible_chunks).toHaveLength(1);

    const recoveredLogs = await db
      .select()
      .from(rollbackLogs)
      .where(eq(rollbackLogs.sessionId, session.session_id));
    expect(recoveredLogs).toHaveLength(1);
  });
});
