import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { makeApp, registerUser, newUuid, type TestUser } from '../helpers/app.js';
import { closePool, db } from '../../apps/api/src/db/index.js';
import {
  chunks,
  learningEvents,
  learningSessions,
  problems,
  programs,
  stageAttempts,
  userProfiles,
} from '../../apps/api/src/db/schema/product.js';
import { toEngineProblemDefinition, type ProblemDefinitionFixture } from '@app/problem-content';
import { buildPublicSession } from '../../apps/api/src/modules/sessions/serializer.js';
import { initialWorkspace, loadChunkRows } from '../../apps/api/src/modules/sessions/repo.js';
import type { ActionType, PublicSession } from '@app/contracts';

/** Unique per run so re-verify against a non-wiped DB cannot collide. */
const PIN_KEY = `EX-PIN-HIST-${randomUUID().slice(0, 8)}`;
/** High difficulty so ACTIVE pin rows never preempt EX-01 for unrelated suites. */
const PIN_DIFFICULTY = 99;

let app: FastifyInstance;
let programId: string;
const createdProblemIds: string[] = [];

beforeAll(async () => {
  app = await makeApp();
  const [program] = await db
    .select({ id: programs.id })
    .from(programs)
    .where(and(eq(programs.slug, 'core-reasoning'), eq(programs.version, 1)));
  programId = program!.id;
});

afterAll(async () => {
  await retirePinProblems();
  await app.close();
  await closePool();
});

async function retirePinProblems(): Promise<void> {
  if (createdProblemIds.length === 0) return;
  await db
    .update(problems)
    .set({ status: 'RETIRED' })
    .where(inArray(problems.id, createdProblemIds));
}

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
): Promise<PublicSession> {
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
  expect(res.statusCode).toBe(200);
  return res.json() as PublicSession;
}

async function completeCanonical(
  user: TestUser,
  assigns: Array<{ slot: string; token_id: string; commit?: boolean }>,
  answer: string,
): Promise<void> {
  let session = await startSession(user);
  for (const step of assigns) {
    session = await act(user, session, 'ASSIGN_SLOT', {
      slot: step.slot,
      token_id: step.token_id,
    });
    if (step.commit !== false && session.allowed_actions.includes('SUBMIT_COMMITMENT')) {
      session = await act(user, session, 'SUBMIT_COMMITMENT', {});
    }
  }
  session = await act(user, session, 'SUBMIT_FINAL_ANSWER', { value: answer });
  expect(session.status).toBe('COMPLETED');
}

const pinDefinition: ProblemDefinitionFixture = {
  workspace_slots: ['WHOLE', 'UNKNOWN'],
  steps: [
    {
      step_pos: 1,
      token_id: 'pin-c0-whole',
      correct_slot: 'WHOLE',
      requires_revealed_chunk_index: 0,
      label: '10',
      options: [
        { slot: 'WHOLE', label: 'Whole' },
        { slot: 'UNKNOWN', label: 'Unknown' },
      ],
    },
    {
      step_pos: 2,
      token_id: 'pin-c1-unknown',
      correct_slot: 'UNKNOWN',
      requires_revealed_chunk_index: 1,
      label: 'unknown',
      options: [
        { slot: 'WHOLE', label: 'Whole' },
        { slot: 'UNKNOWN', label: 'Unknown' },
      ],
    },
  ],
  fact_establishments: [],
  sufficiency_dependencies: [],
  gates: [{ reveals_chunk_index: 1, requires_commitment: 'WHOLE_IDENTIFIED' }],
  completion_rule: { requires_slots_filled: ['WHOLE', 'UNKNOWN'] },
  expected_final_result: { value: '5', unit: 'units' },
};

async function insertPinProblem(version: number, status: 'ACTIVE' | 'RETIRED'): Promise<string> {
  const definition: ProblemDefinitionFixture = {
    ...pinDefinition,
    expected_final_result: {
      value: version === 1 ? '5' : '7',
      unit: 'units',
    },
  };
  const [row] = await db
    .insert(problems)
    .values({
      programId,
      problemKey: PIN_KEY,
      version,
      domain: 'PERCENT',
      title: `Pinning fixture v${version}`,
      difficultyLevel: PIN_DIFFICULTY,
      fullText: `Pinning problem version ${version}. How many?`,
      definition,
      status,
    })
    .returning({ id: problems.id });
  const problemId = row!.id;
  createdProblemIds.push(problemId);

  await db.insert(chunks).values([
    {
      problemId,
      orderIndex: 0,
      chunkType: 'CONTEXT',
      content: `Pinning chunk 0 for version ${version}.`,
      semanticDefinition: {
        tokens: [{ token_id: 'pin-c0-whole', text: '10', role: 'QUANTITY' }],
      },
    },
    {
      problemId,
      orderIndex: 1,
      chunkType: 'QUESTION',
      content: `Pinning question for version ${version}.`,
      semanticDefinition: {
        tokens: [{ token_id: 'pin-c1-unknown', text: 'unknown', role: 'UNKNOWN' }],
      },
    },
  ]);
  return problemId;
}

/** Create a real session row pinned to a specific problem version (bypasses next-problem order). */
async function openPinnedSession(
  user: TestUser,
  problemId: string,
  contentVersion: number,
): Promise<PublicSession> {
  const me = await authed(user, { method: 'GET', url: '/api/me' });
  expect(me.statusCode).toBe(200);
  const analyticsSubjectId = (me.json() as { analytics_subject_id: string }).analytics_subject_id;

  const [profile] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.analyticsSubjectId, analyticsSubjectId));
  expect(profile).toBeTruthy();

  const [problem] = await db.select().from(problems).where(eq(problems.id, problemId));
  const definition = problem!.definition as ProblemDefinitionFixture;
  const chunkRows = await loadChunkRows(db, problemId);
  const workspace = initialWorkspace(definition.workspace_slots);
  const problemDefinition = toEngineProblemDefinition(
    problem!.problemKey,
    definition,
    chunkRows.length,
  );
  const sessionId = randomUUID();
  const publicSession = buildPublicSession({
    sessionId,
    stateVersion: 0,
    status: 'ACTIVE',
    engineVersion: '1.0.0',
    contentVersion,
    currentChunkIndex: 0,
    workspaceSlots: definition.workspace_slots,
    workspace,
    acceptedCommitments: [],
    chunks: chunkRows,
    message: null,
    problemDefinition,
  });

  await db.insert(learningSessions).values({
    id: sessionId,
    analyticsSubjectId,
    problemId,
    engineVersion: '1.0.0',
    contentVersion,
    status: 'ACTIVE',
    stateVersion: 0,
    currentChunkIndex: 0,
    workspaceState: workspace,
    acceptedCommitments: [],
    requiredNextAction: publicSession.required_next_action,
    publicState: publicSession,
  });
  await db.insert(learningEvents).values({
    sessionId,
    analyticsSubjectId,
    problemId,
    eventType: 'SESSION_STARTED',
    payload: { problem_key: problem!.problemKey },
    engineVersion: '1.0.0',
    contentVersion,
  });

  return publicSession;
}

describe('historical session content pinning (AC-013)', () => {
  it('keeps an active v1 session pinned after v2 is activated; new sessions use v2', async () => {
    try {
      // 1) Version 1 is ACTIVE.
      const v1Id = await insertPinProblem(1, 'ACTIVE');
      const [v1] = await db
        .select({ status: problems.status, version: problems.version })
        .from(problems)
        .where(eq(problems.id, v1Id));
      expect(v1).toEqual({ status: 'ACTIVE', version: 1 });

      // 2) Session starts and is pinned to version 1.
      const owner = await registerUser(app);
      let session = await openPinnedSession(owner, v1Id, 1);
      expect(session.content_version).toBe(1);
      expect(session.visible_chunks[0]?.content).toContain('version 1');

      const [pinned] = await db
        .select({
          problemId: learningSessions.problemId,
          contentVersion: learningSessions.contentVersion,
        })
        .from(learningSessions)
        .where(eq(learningSessions.id, session.session_id));
      expect(pinned!.problemId).toBe(v1Id);
      expect(pinned!.contentVersion).toBe(1);

      session = await act(owner, session, 'ASSIGN_SLOT', {
        slot: 'WHOLE',
        token_id: 'pin-c0-whole',
      });
      expect(session.state_version).toBe(1);
      expect(session.content_version).toBe(1);

      // 3) Import/activate version 2 retires version 1 (same rule as content importer).
      const v2Id = await insertPinProblem(2, 'ACTIVE');
      await db
        .update(problems)
        .set({ status: 'RETIRED' })
        .where(
          and(
            eq(problems.programId, programId),
            eq(problems.problemKey, PIN_KEY),
            eq(problems.status, 'ACTIVE'),
            ne(problems.id, v2Id),
          ),
        );

      const [v1After] = await db
        .select({ status: problems.status })
        .from(problems)
        .where(eq(problems.id, v1Id));
      const [v2After] = await db
        .select({ status: problems.status })
        .from(problems)
        .where(eq(problems.id, v2Id));
      expect(v1After!.status).toBe('RETIRED');
      expect(v2After!.status).toBe('ACTIVE');

      // 4) Existing session still loads and continues against version 1 unchanged.
      const resumed = await authed(owner, {
        method: 'GET',
        url: `/api/sessions/${session.session_id}`,
      });
      expect(resumed.statusCode).toBe(200);
      const resumedBody = resumed.json() as PublicSession;
      expect(resumedBody.content_version).toBe(1);
      expect(resumedBody.visible_chunks[0]?.content).toContain('version 1');
      expect(resumedBody.visible_chunks[0]?.content).not.toContain('version 2');
      expect(resumedBody.completed_steps.some((s) => s.token_id === 'pin-c0-whole')).toBe(true);

      session = await act(owner, resumedBody, 'SUBMIT_COMMITMENT', {});
      expect(session.content_version).toBe(1);
      expect(session.visible_chunks.map((c) => c.order_index)).toEqual([0, 1]);
      expect(session.visible_chunks[1]?.content).toContain('version 1');

      const [stillPinned] = await db
        .select({
          problemId: learningSessions.problemId,
          contentVersion: learningSessions.contentVersion,
        })
        .from(learningSessions)
        .where(eq(learningSessions.id, session.session_id));
      expect(stillPinned!.problemId).toBe(v1Id);
      expect(stillPinned!.contentVersion).toBe(1);

      const attempts = await db
        .select()
        .from(stageAttempts)
        .where(eq(stageAttempts.sessionId, session.session_id));
      expect(attempts.length).toBeGreaterThanOrEqual(2);
      const events = await db
        .select()
        .from(learningEvents)
        .where(eq(learningEvents.sessionId, session.session_id));
      expect(events.some((e) => e.eventType === 'SLOT_ASSIGNED')).toBe(true);
      expect(events.every((e) => e.contentVersion === 1)).toBe(true);

      // 5) A new session selects version 2 once canonical problems are completed.
      const other = await registerUser(app);
      await completeCanonical(
        other,
        [
          { slot: 'WHOLE', token_id: 'ex01-c0-whole' },
          { slot: 'PART_IN_PERCENTAGE', token_id: 'ex01-c1-percent' },
          { slot: 'UNKNOWN', token_id: 'ex01-c2-unknown', commit: false },
        ],
        '12',
      );
      await completeCanonical(
        other,
        [
          { slot: 'RATIO', token_id: 'ex02-c0-ratio' },
          { slot: 'PART_IN_NUMBER', token_id: 'ex02-c1-blue' },
          { slot: 'UNKNOWN', token_id: 'ex02-c2-unknown', commit: false },
        ],
        '10',
      );
      await completeCanonical(
        other,
        [
          { slot: 'WHOLE', token_id: 'ex04-c0-whole' },
          { slot: 'PART_IN_PERCENTAGE', token_id: 'ex04-c1-percent' },
          { slot: 'UNKNOWN', token_id: 'ex04-c2-unknown', commit: false },
        ],
        '12',
      );
      await completeCanonical(
        other,
        [
          { slot: 'FRACTION', token_id: 'ex03-c0-fraction' },
          { slot: 'WHOLE', token_id: 'ex03-c1-whole' },
          { slot: 'UNKNOWN', token_id: 'ex03-c2-unknown', commit: false },
        ],
        '20',
      );

      const fresh = await startSession(other);
      expect(fresh.content_version).toBe(2);
      expect(fresh.visible_chunks[0]?.content).toContain('version 2');
      expect(fresh.visible_chunks[0]?.content).not.toContain('version 1');

      const [freshRow] = await db
        .select({
          problemId: learningSessions.problemId,
          contentVersion: learningSessions.contentVersion,
        })
        .from(learningSessions)
        .where(eq(learningSessions.id, fresh.session_id));
      expect(freshRow!.problemId).toBe(v2Id);
      expect(freshRow!.contentVersion).toBe(2);
    } finally {
      await retirePinProblems();
    }
  });
});
