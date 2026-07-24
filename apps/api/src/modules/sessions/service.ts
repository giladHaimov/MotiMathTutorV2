import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { ActionRequest, PublicSession } from '@app/contracts';
import { applyAction, type EngineSessionState, type WorkspaceState } from '@app/engine';
import { toEngineProblemDefinition, type ProblemDefinitionFixture } from '@app/problem-content';
import type { Db } from '../../db/index.js';
import {
  learningEvents,
  learningSessions,
  problems,
  stageAttempts,
} from '../../db/schema/product.js';
import { ApiError } from '../../http/errors.js';
import type { Profile } from '../profile/service.js';
import { buildPublicSession } from './serializer.js';
import { initialWorkspace, loadChunkRows, pickNextProblem } from './repo.js';
import { runPostAcceptWriteHook } from './test-hooks.js';

export type SubmitOutcome =
  | { kind: 'APPLIED'; session: PublicSession }
  | { kind: 'REJECTED'; session: PublicSession }
  | { kind: 'CONFLICT'; current: PublicSession };

/**
 * Start (or resume) the student's session (J-02). If an ACTIVE session already
 * exists it is returned instead of creating a duplicate; otherwise the next
 * deterministic problem is started, pinned to engine + content versions
 * (AC-010), returning only the first permitted chunk (AC-011).
 */
export async function startSession(
  db: Db,
  profile: Profile,
  engineVersion: string,
): Promise<PublicSession> {
  const active = await db
    .select({ id: learningSessions.id })
    .from(learningSessions)
    .where(
      and(
        eq(learningSessions.analyticsSubjectId, profile.analyticsSubjectId),
        eq(learningSessions.status, 'ACTIVE'),
      ),
    )
    .orderBy(desc(learningSessions.updatedAt))
    .limit(1);

  if (active[0]) {
    return getSession(db, profile, active[0].id);
  }

  const problem = await pickNextProblem(db, profile.analyticsSubjectId);
  if (!problem) {
    throw new ApiError('NO_CONTENT_AVAILABLE', 'No active problem is available.');
  }

  const chunkRows = await loadChunkRows(db, problem.id);
  const workspace = initialWorkspace(problem.definition.workspace_slots);
  const sessionId = randomUUID();
  const problemDefinition = toEngineProblemDefinition(
    problem.problemKey,
    problem.definition,
    chunkRows.length,
  );

  const publicSession = buildPublicSession({
    sessionId,
    stateVersion: 0,
    status: 'ACTIVE',
    engineVersion,
    contentVersion: problem.contentVersion,
    currentChunkIndex: 0,
    workspaceSlots: problem.definition.workspace_slots,
    workspace,
    acceptedCommitments: [],
    chunks: chunkRows,
    message: null,
    problemDefinition,
  });

  await db.transaction(async (tx) => {
    await tx.insert(learningSessions).values({
      id: sessionId,
      analyticsSubjectId: profile.analyticsSubjectId,
      problemId: problem.id,
      engineVersion,
      contentVersion: problem.contentVersion,
      status: 'ACTIVE',
      stateVersion: 0,
      currentChunkIndex: 0,
      workspaceState: workspace,
      acceptedCommitments: [],
      requiredNextAction: publicSession.required_next_action,
      publicState: publicSession,
    });
    await tx.insert(learningEvents).values({
      sessionId,
      analyticsSubjectId: profile.analyticsSubjectId,
      problemId: problem.id,
      eventType: 'SESSION_STARTED',
      payload: { problem_key: problem.problemKey },
      engineVersion,
      contentVersion: problem.contentVersion,
    });
  });

  return publicSession;
}

/** Resume an authorized session (J-03). Cross-user access yields a consistent 404 (AC-005). */
export async function getSession(
  db: Db,
  profile: Profile,
  sessionId: string,
): Promise<PublicSession> {
  const rows = await db.select().from(learningSessions).where(eq(learningSessions.id, sessionId));
  const s = rows[0];
  if (!s || s.analyticsSubjectId !== profile.analyticsSubjectId) {
    // Knowledge of a UUID is never authorization (ARCHITECTURE §11).
    throw new ApiError('NOT_FOUND', 'Session not found.');
  }

  const definition = await loadDefinition(db, s.problemId);
  const chunkRows = await loadChunkRows(db, s.problemId);
  const problemDefinition = toEngineProblemDefinition('pinned', definition, chunkRows.length);

  return buildPublicSession({
    sessionId: s.id,
    stateVersion: s.stateVersion,
    status: s.status as 'ACTIVE' | 'COMPLETED' | 'ABANDONED',
    engineVersion: s.engineVersion,
    contentVersion: s.contentVersion,
    currentChunkIndex: s.currentChunkIndex,
    workspaceSlots: definition.workspace_slots,
    workspace: s.workspaceState as WorkspaceState,
    acceptedCommitments: s.acceptedCommitments as string[],
    chunks: chunkRows,
    message: null,
    problemDefinition,
  });
}

/**
 * Submit one structured action inside the ARCHITECTURE §8 transaction:
 * idempotency → row lock → ownership → version compare → pure engine →
 * atomic persistence of attempt + events + session state.
 */
export async function submitAction(
  db: Db,
  profile: Profile,
  sessionId: string,
  req: ActionRequest,
): Promise<SubmitOutcome> {
  return db.transaction(async (tx) => {
    // (4) Lock the session row FOR UPDATE — serializes concurrent actions (AC-019).
    const locked = await tx
      .select()
      .from(learningSessions)
      .where(eq(learningSessions.id, sessionId))
      .for('update');
    const s = locked[0];

    // (5) Ownership — consistent 404 for another student's (or unknown) session.
    if (!s || s.analyticsSubjectId !== profile.analyticsSubjectId) {
      throw new ApiError('NOT_FOUND', 'Session not found.');
    }

    // (2/3) Idempotency — a completed duplicate replays its stored result AND its
    // original outcome, so the retry's HTTP status matches the first response
    // (AC-017): a conflict replays 409, an applied/rejected replays 200.
    const existing = await tx
      .select({
        completedAt: stageAttempts.completedAt,
        outcome: stageAttempts.outcome,
        publicResult: stageAttempts.publicResult,
      })
      .from(stageAttempts)
      .where(
        and(
          eq(stageAttempts.sessionId, sessionId),
          eq(stageAttempts.clientActionId, req.client_action_id),
        ),
      );
    if (existing[0]?.completedAt && existing[0].publicResult) {
      const stored = existing[0].publicResult as PublicSession;
      switch (existing[0].outcome) {
        case 'CONFLICT':
          return { kind: 'CONFLICT', current: stored };
        case 'REJECTED':
          return { kind: 'REJECTED', session: stored };
        default:
          return { kind: 'APPLIED', session: stored };
      }
    }

    if (s.status !== 'ACTIVE') {
      throw new ApiError('SESSION_COMPLETED', 'This session can no longer be changed.');
    }

    const definition = await loadDefinition(tx, s.problemId);
    const chunkRows = await loadChunkRows(tx, s.problemId);
    const problemDefinition = toEngineProblemDefinition('pinned', definition, chunkRows.length);

    const seqRows = await tx
      .select({ next: sql<number>`coalesce(max(${stageAttempts.sequenceNo}), 0) + 1` })
      .from(stageAttempts)
      .where(eq(stageAttempts.sessionId, sessionId));
    const sequenceNo = Number(seqRows[0]?.next ?? 1);

    const baseSerialize = {
      sessionId: s.id,
      engineVersion: s.engineVersion,
      contentVersion: s.contentVersion,
      workspaceSlots: definition.workspace_slots,
      chunks: chunkRows,
      problemDefinition,
    };

    // (6) State-version compare — stale version changes nothing (AC-018).
    if (req.expected_state_version !== s.stateVersion) {
      const current = buildPublicSession({
        ...baseSerialize,
        stateVersion: s.stateVersion,
        status: 'ACTIVE',
        currentChunkIndex: s.currentChunkIndex,
        workspace: s.workspaceState as WorkspaceState,
        acceptedCommitments: s.acceptedCommitments as string[],
        message: 'The session changed. Reloaded current state.',
      });
      await tx.insert(stageAttempts).values({
        sessionId,
        clientActionId: req.client_action_id,
        sequenceNo,
        expectedStateVersion: req.expected_state_version,
        stateVersionAfter: null,
        actionType: req.action_type,
        payload: req.payload,
        outcome: 'CONFLICT',
        publicResult: current,
        completedAt: new Date(),
      });
      await tx.insert(learningEvents).values({
        sessionId,
        analyticsSubjectId: s.analyticsSubjectId,
        problemId: s.problemId,
        eventType: 'STATE_VERSION_CONFLICT',
        payload: { expected: req.expected_state_version, actual: s.stateVersion },
        engineVersion: s.engineVersion,
        contentVersion: s.contentVersion,
      });
      return { kind: 'CONFLICT', current };
    }

    // (7/8) Pure engine transition — no I/O.
    const engineState: EngineSessionState = {
      status: 'ACTIVE',
      current_chunk_index: s.currentChunkIndex,
      workspace: s.workspaceState as WorkspaceState,
      accepted_commitments: s.acceptedCommitments as string[],
    };
    const result = applyAction({
      problemDefinition,
      sessionState: engineState,
      action: { action_type: req.action_type, payload: req.payload },
    });

    const attemptId = randomUUID();

    if (result.outcome === 'ACCEPTED') {
      const newVersion = s.stateVersion + 1;
      const nextStatus = result.nextState.status;
      const completedAt = nextStatus === 'COMPLETED' ? new Date() : null;
      const publicSession = buildPublicSession({
        ...baseSerialize,
        stateVersion: newVersion,
        status: nextStatus,
        currentChunkIndex: result.nextState.current_chunk_index,
        workspace: result.nextState.workspace,
        acceptedCommitments: result.nextState.accepted_commitments,
        message: result.message,
      });

      // (10) Advance state + version atomically with attempt + events.
      await tx
        .update(learningSessions)
        .set({
          stateVersion: newVersion,
          status: nextStatus,
          completedAt,
          currentChunkIndex: result.nextState.current_chunk_index,
          workspaceState: result.nextState.workspace,
          acceptedCommitments: result.nextState.accepted_commitments,
          requiredNextAction: publicSession.required_next_action,
          publicState: publicSession,
          updatedAt: new Date(),
        })
        .where(eq(learningSessions.id, sessionId));

      await tx.insert(stageAttempts).values({
        id: attemptId,
        sessionId,
        clientActionId: req.client_action_id,
        sequenceNo,
        expectedStateVersion: req.expected_state_version,
        stateVersionAfter: newVersion,
        actionType: req.action_type,
        payload: req.payload,
        outcome: 'ACCEPTED',
        misconceptionCode: null,
        publicResult: publicSession,
        completedAt: new Date(),
      });

      await insertEvents(tx, {
        sessionId,
        attemptId,
        analyticsSubjectId: s.analyticsSubjectId,
        problemId: s.problemId,
        engineVersion: s.engineVersion,
        contentVersion: s.contentVersion,
        events: result.events,
      });

      // Test-only fault injection point: throwing here must roll back the whole
      // unit (state update + attempt + events). No-op in production.
      await runPostAcceptWriteHook();

      return { kind: 'APPLIED', session: publicSession };
    }

    // REJECTED semantic action — recorded, but no state advance.
    const publicSession = buildPublicSession({
      ...baseSerialize,
      stateVersion: s.stateVersion,
      status: 'ACTIVE',
      currentChunkIndex: s.currentChunkIndex,
      workspace: s.workspaceState as WorkspaceState,
      acceptedCommitments: s.acceptedCommitments as string[],
      message: result.message,
    });
    await tx.insert(stageAttempts).values({
      id: attemptId,
      sessionId,
      clientActionId: req.client_action_id,
      sequenceNo,
      expectedStateVersion: req.expected_state_version,
      stateVersionAfter: null,
      actionType: req.action_type,
      payload: req.payload,
      outcome: 'REJECTED',
      misconceptionCode: result.misconception_code,
      publicResult: publicSession,
      completedAt: new Date(),
    });
    await insertEvents(tx, {
      sessionId,
      attemptId,
      analyticsSubjectId: s.analyticsSubjectId,
      problemId: s.problemId,
      engineVersion: s.engineVersion,
      contentVersion: s.contentVersion,
      events: result.events,
    });

    return { kind: 'REJECTED', session: publicSession };
  });
}

type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

async function loadDefinition(
  exec: Executor,
  problemId: string,
): Promise<ProblemDefinitionFixture> {
  const rows = await exec
    .select({ definition: problems.definition })
    .from(problems)
    .where(eq(problems.id, problemId));
  const row = rows[0];
  if (!row) throw new ApiError('INTERNAL_ERROR', 'Pinned problem missing.');
  return row.definition as ProblemDefinitionFixture;
}

async function insertEvents(
  tx: Parameters<Parameters<Db['transaction']>[0]>[0],
  args: {
    sessionId: string;
    attemptId: string;
    analyticsSubjectId: string;
    problemId: string;
    engineVersion: string;
    contentVersion: number;
    events: Array<{
      event_type: string;
      misconception_code: string | null;
      payload: Record<string, unknown>;
    }>;
  },
): Promise<void> {
  for (const ev of args.events) {
    await tx.insert(learningEvents).values({
      sessionId: args.sessionId,
      attemptId: args.attemptId,
      analyticsSubjectId: args.analyticsSubjectId,
      problemId: args.problemId,
      eventType: ev.event_type,
      payload: ev.payload,
      misconceptionCode: ev.misconception_code,
      engineVersion: args.engineVersion,
      contentVersion: args.contentVersion,
    });
  }
}
