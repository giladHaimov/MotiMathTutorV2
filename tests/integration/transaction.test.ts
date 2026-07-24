import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { makeApp, registerUser, newUuid, type TestUser } from '../helpers/app.js';
import { closePool, db } from '../../apps/api/src/db/index.js';
import {
  learningEvents,
  learningSessions,
  stageAttempts,
} from '../../apps/api/src/db/schema/product.js';
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

describe('transactional integrity (AC-021, SCN-12)', () => {
  it('a failure mid-transition leaves no partial attempt/event/state', async () => {
    const session = (
      await app.inject({ method: 'POST', url: '/api/sessions', headers: { cookie: user.cookie } })
    ).json() as PublicSession;

    const before = (
      await db.select().from(learningSessions).where(eq(learningSessions.id, session.session_id))
    )[0]!;

    const sentinel = newUuid();

    // Fault injection: write attempt + event + state bump inside a transaction,
    // then throw. PostgreSQL must roll the whole unit back.
    await expect(
      db.transaction(async (tx) => {
        await tx.insert(stageAttempts).values({
          sessionId: session.session_id,
          clientActionId: sentinel,
          sequenceNo: 999,
          expectedStateVersion: session.state_version,
          stateVersionAfter: session.state_version + 1,
          actionType: 'ASSIGN_SLOT',
          payload: { slot: 'WHOLE' },
          outcome: 'ACCEPTED',
          completedAt: new Date(),
        });
        await tx.insert(learningEvents).values({
          sessionId: session.session_id,
          analyticsSubjectId: before.analyticsSubjectId,
          problemId: before.problemId,
          eventType: 'SLOT_ASSIGNED',
          payload: {},
          engineVersion: before.engineVersion,
          contentVersion: before.contentVersion,
        });
        await tx
          .update(learningSessions)
          .set({ stateVersion: session.state_version + 1 })
          .where(eq(learningSessions.id, session.session_id));
        throw new Error('injected failure after partial writes');
      }),
    ).rejects.toThrow(/injected failure/);

    // Nothing from the failed transaction survived.
    const attempts = await db
      .select()
      .from(stageAttempts)
      .where(
        and(
          eq(stageAttempts.sessionId, session.session_id),
          eq(stageAttempts.clientActionId, sentinel),
        ),
      );
    expect(attempts).toHaveLength(0);

    const after = (
      await db.select().from(learningSessions).where(eq(learningSessions.id, session.session_id))
    )[0]!;
    expect(after.stateVersion).toBe(before.stateVersion);
  });
});
