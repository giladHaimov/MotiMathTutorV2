import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { makeApp, registerUser, newUuid, type TestUser } from '../helpers/app.js';
import { closePool, db } from '../../apps/api/src/db/index.js';
import { stageAttempts } from '../../apps/api/src/db/schema/product.js';
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

const as = (o: Parameters<FastifyInstance['inject']>[0]) => {
  const opts = typeof o === 'string' ? { url: o } : o;
  return app.inject({ ...opts, headers: { cookie: user.cookie, ...(opts.headers ?? {}) } });
};

describe('concurrent action serialization (AC-019, SCN-09)', () => {
  it('two concurrent actions on the same version: exactly one advances, the other conflicts', async () => {
    const session = (await as({ method: 'POST', url: '/api/sessions' })).json() as PublicSession;
    const token = session.visible_chunks[0]!.tokens[0]!.token_id;

    const submit = (clientActionId: string) =>
      as({
        method: 'POST',
        url: `/api/sessions/${session.session_id}/actions`,
        payload: {
          client_action_id: clientActionId,
          expected_state_version: session.state_version, // both target version 0
          action_type: 'ASSIGN_SLOT',
          payload: { slot: 'WHOLE', token_id: token },
        },
      });

    // Fire both at once — the FOR UPDATE row lock must serialize them.
    const [a, b] = await Promise.all([submit(newUuid()), submit(newUuid())]);
    const statuses = [a.statusCode, b.statusCode].sort();
    expect(statuses).toEqual([200, 409]);

    const applied = (statuses[0] === 200 && a.statusCode === 200 ? a : b).json() as PublicSession;
    expect(applied.state_version).toBe(session.state_version + 1);

    const conflict = (a.statusCode === 409 ? a : b).json() as {
      error: { code: string };
      current_state: PublicSession;
    };
    expect(conflict.error.code).toBe('STATE_VERSION_CONFLICT');

    // Exactly one accepted attempt and one conflict attempt were recorded.
    const attempts = await db
      .select()
      .from(stageAttempts)
      .where(eq(stageAttempts.sessionId, session.session_id));
    expect(attempts.filter((x) => x.outcome === 'ACCEPTED')).toHaveLength(1);
    expect(attempts.filter((x) => x.outcome === 'CONFLICT')).toHaveLength(1);
  });
});
