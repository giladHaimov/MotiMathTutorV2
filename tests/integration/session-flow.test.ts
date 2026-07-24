import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { makeApp, registerUser, newUuid, type TestUser } from '../helpers/app.js';
import { closePool, db } from '../../apps/api/src/db/index.js';
import { learningEvents, stageAttempts } from '../../apps/api/src/db/schema/product.js';
import type { PublicSession } from '@app/contracts';

let app: FastifyInstance;
let user: TestUser;

beforeAll(async () => {
  app = await makeApp();
  user = await registerUser(app);
});
afterAll(async () => {
  await app.close();
  await closePool();
});

function authed(opts: Parameters<FastifyInstance['inject']>[0]) {
  const o = typeof opts === 'string' ? { url: opts } : opts;
  return app.inject({ ...o, headers: { cookie: user.cookie, ...(o.headers ?? {}) } });
}

async function startSession(): Promise<PublicSession> {
  const res = await authed({ method: 'POST', url: '/api/sessions' });
  return res.json() as PublicSession;
}

describe('session flow (real API + PostgreSQL)', () => {
  it('start exposes only the first chunk and no hidden text (AC-011/012, SCN-02)', async () => {
    const res = await authed({ method: 'POST', url: '/api/sessions' });
    expect(res.statusCode).toBe(201);
    const s = res.json() as PublicSession;
    expect(s.visible_chunks).toHaveLength(1);
    expect(s.visible_chunks[0]!.order_index).toBe(0);
    // Future chunks and full problem text must never appear.
    expect(res.body).not.toContain('Thirty percent');
    expect(res.body).not.toContain('How many students');
  });

  it('accepted action persists attempt + event + state atomically (AC-020/044)', async () => {
    const session = await startSession();
    const token = session.visible_chunks[0]!.tokens[0]!.token_id;
    const clientActionId = newUuid();

    const res = await authed({
      method: 'POST',
      url: `/api/sessions/${session.session_id}/actions`,
      payload: {
        client_action_id: clientActionId,
        expected_state_version: session.state_version,
        action_type: 'ASSIGN_SLOT',
        payload: { slot: 'WHOLE', token_id: token },
      },
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json() as PublicSession;
    expect(updated.state_version).toBe(session.state_version + 1);
    expect(updated.workspace.slots.find((s) => s.slot === 'WHOLE')?.token_id).toBe(token);

    const attempts = await db
      .select()
      .from(stageAttempts)
      .where(eq(stageAttempts.sessionId, session.session_id));
    const accepted = attempts.filter((a) => a.outcome === 'ACCEPTED');
    expect(accepted).toHaveLength(1);

    const events = await db
      .select()
      .from(learningEvents)
      .where(eq(learningEvents.sessionId, session.session_id));
    expect(events.some((e) => e.eventType === 'SESSION_STARTED')).toBe(true);
    expect(events.some((e) => e.eventType === 'SLOT_ASSIGNED')).toBe(true);
    // Learning events reference the pseudonymous subject + versions (AC-043).
    expect(events[0]!.analyticsSubjectId).toBeTruthy();
    expect(events[0]!.engineVersion).toBe('1.0.0');
  });

  it('duplicate client_action_id changes state once (AC-017, SCN-08)', async () => {
    const session = await startSession();
    const token = session.visible_chunks[0]!.tokens[0]!.token_id;
    const clientActionId = newUuid();
    const body = {
      client_action_id: clientActionId,
      expected_state_version: session.state_version,
      action_type: 'ASSIGN_SLOT' as const,
      payload: { slot: 'WHOLE' as const, token_id: token },
    };

    const first = await authed({
      method: 'POST',
      url: `/api/sessions/${session.session_id}/actions`,
      payload: body,
    });
    const second = await authed({
      method: 'POST',
      url: `/api/sessions/${session.session_id}/actions`,
      payload: body,
    });

    const v1 = (first.json() as PublicSession).state_version;
    const v2 = (second.json() as PublicSession).state_version;
    expect(v2).toBe(v1); // applied once

    const applied = await db
      .select()
      .from(stageAttempts)
      .where(eq(stageAttempts.clientActionId, clientActionId));
    expect(applied).toHaveLength(1);
  });

  it('stale expected_state_version is rejected with authoritative state (AC-018, SCN-09)', async () => {
    const session = await startSession();
    const res = await authed({
      method: 'POST',
      url: `/api/sessions/${session.session_id}/actions`,
      payload: {
        client_action_id: newUuid(),
        expected_state_version: 999, // stale
        action_type: 'ASSIGN_SLOT',
        payload: { slot: 'WHOLE', token_id: session.visible_chunks[0]!.tokens[0]!.token_id },
      },
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: { code: string }; current_state: PublicSession };
    expect(body.error.code).toBe('STATE_VERSION_CONFLICT');
    expect(body.current_state.state_version).toBe(session.state_version);
  });

  it('malformed action payload is rejected without state change (AC-016)', async () => {
    const session = await startSession();
    const res = await authed({
      method: 'POST',
      url: `/api/sessions/${session.session_id}/actions`,
      payload: { client_action_id: 'not-a-uuid', action_type: 'ASSIGN_SLOT' },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
  });
});
