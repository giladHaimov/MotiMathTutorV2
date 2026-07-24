import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { makeApp, registerUser, newUuid, type TestUser } from '../helpers/app.js';
import { closePool, db } from '../../apps/api/src/db/index.js';
import {
  learningEvents,
  learningSessions,
  stageAttempts,
} from '../../apps/api/src/db/schema/product.js';
import { setPostAcceptWriteHook } from '../../apps/api/src/modules/sessions/test-hooks.js';
import type { PublicSession } from '@app/contracts';

let app: FastifyInstance;
let user: TestUser;

beforeAll(async () => {
  app = await makeApp();
  user = await registerUser(app);
});
afterEach(() => setPostAcceptWriteHook(null));
afterAll(async () => {
  await app.close();
  await closePool();
});

const as = (o: Parameters<FastifyInstance['inject']>[0]) => {
  const opts = typeof o === 'string' ? { url: o } : o;
  return app.inject({ ...opts, headers: { cookie: user.cookie, ...(opts.headers ?? {}) } });
};

describe('transactional integrity of the real accepted transition (AC-020/021, SCN-12)', () => {
  it('a failure after the state update + attempt + event inserts rolls the whole unit back', async () => {
    const session = (await as({ method: 'POST', url: '/api/sessions' })).json() as PublicSession;
    const token = session.visible_chunks[0]!.tokens[0]!.token_id;
    const clientActionId = newUuid();

    // Inject a failure at the end of the accepted transaction (after all writes).
    setPostAcceptWriteHook(() => {
      throw new Error('injected failure after accepted writes');
    });

    const failed = await as({
      method: 'POST',
      url: `/api/sessions/${session.session_id}/actions`,
      payload: {
        client_action_id: clientActionId,
        expected_state_version: session.state_version,
        action_type: 'ASSIGN_SLOT',
        payload: { slot: 'WHOLE', token_id: token },
      },
    });
    expect(failed.statusCode).toBe(500);

    // Nothing from the failed accepted transition survived (full rollback).
    const after = (
      await db.select().from(learningSessions).where(eq(learningSessions.id, session.session_id))
    )[0]!;
    expect(after.stateVersion).toBe(session.state_version);

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

    const slotEvents = await db
      .select()
      .from(learningEvents)
      .where(
        and(
          eq(learningEvents.sessionId, session.session_id),
          eq(learningEvents.eventType, 'SLOT_ASSIGNED'),
        ),
      );
    expect(slotEvents).toHaveLength(0);

    // Recovery: with the fault cleared, the same action now applies cleanly once.
    setPostAcceptWriteHook(null);
    const ok = await as({
      method: 'POST',
      url: `/api/sessions/${session.session_id}/actions`,
      payload: {
        client_action_id: clientActionId,
        expected_state_version: session.state_version,
        action_type: 'ASSIGN_SLOT',
        payload: { slot: 'WHOLE', token_id: token },
      },
    });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as PublicSession).state_version).toBe(session.state_version + 1);
  });
});
