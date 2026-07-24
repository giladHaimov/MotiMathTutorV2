import { randomUUID } from 'node:crypto';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { ActionRequest, PublicSession } from '@app/contracts';
import { applyAction, type EngineProblemDefinition, type EngineSessionState } from '@app/engine';
import { toEngineProblemDefinition, type ProblemDefinitionFixture } from '@app/problem-content';
import type { Db } from '../../db/index.js';
import {
  learningEvents,
  learningSessions,
  problems,
  rollbackLogs,
  rollbackRules,
  stageAttempts,
} from '../../db/schema/product.js';
import { ApiError } from '../../http/errors.js';
import type { Profile } from '../profile/service.js';
import { buildPublicSession } from './serializer.js';
import {
  findActiveSessionId,
  initialWorkspace,
  loadChunkRows,
  normalizeWorkspace,
  pickNextProblem,
} from './repo.js';
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
 *
 * Race safety: concurrent callers (double-tap, multiple tabs/devices, or two
 * API instances behind a load balancer) must converge on exactly one ACTIVE
 * session. A plain SELECT-then-INSERT is not a concurrency boundary — two
 * callers can both pass the SELECT before either commits. Instead the insert
 * itself is the boundary: it targets `learning_sessions_one_active_per_subject_uq`
 * (a DB-level partial unique index — see db/migrations) via `ON CONFLICT ...
 * DO NOTHING`. A caller that loses the race gets zero rows back from the
 * insert and re-reads the row the winner committed, rather than erroring.
 */
export async function startSession(
  db: Db,
  profile: Profile,
  engineVersion: string,
): Promise<PublicSession> {
  const activeId = await findActiveSessionId(db, profile.analyticsSubjectId);
  if (activeId) {
    return getSession(db, profile, activeId);
  }

  const problem = await pickNextProblem(db, profile.analyticsSubjectId);
  if (!problem) {
    throw new ApiError('NO_CONTENT_AVAILABLE', 'No active problem is available.');
  }

  const chunkRows = await loadChunkRows(db, problem.id);
  const workspace = initialWorkspace(problem.definition.workspace_slots);
  const sessionId = randomUUID();
  const rules = await loadRollbackRules(db, problem.id);
  const problemDefinition = withRollbackRules(
    toEngineProblemDefinition(problem.problemKey, problem.definition, chunkRows.length),
    rules,
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
    guidanceCode: null,
    problemDefinition,
  });

  const won = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(learningSessions)
      .values({
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
      })
      .onConflictDoNothing({
        target: learningSessions.analyticsSubjectId,
        where: sql`${learningSessions.status} = 'ACTIVE'`,
      })
      .returning({ id: learningSessions.id });

    // Empty RETURNING means the partial unique index rejected us: a concurrent
    // caller already holds the ACTIVE session for this subject. Do not record
    // a SESSION_STARTED event for a session we did not actually create.
    if (inserted.length === 0) {
      return false;
    }

    await tx.insert(learningEvents).values({
      sessionId,
      analyticsSubjectId: profile.analyticsSubjectId,
      problemId: problem.id,
      eventType: 'SESSION_STARTED',
      payload: { problem_key: problem.problemKey },
      engineVersion,
      contentVersion: problem.contentVersion,
    });
    return true;
  });

  if (won) {
    return publicSession;
  }

  // Lost the race — read back the winner's committed row. In the vanishingly
  // unlikely case it was already completed/abandoned by the time we look
  // (e.g. an extremely fast concurrent completion), the ACTIVE slot is free
  // again, so retry rather than surface an internal error to the caller.
  const winnerId = await findActiveSessionId(db, profile.analyticsSubjectId);
  if (!winnerId) {
    return startSession(db, profile, engineVersion);
  }
  return getSession(db, profile, winnerId);
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
  const rules = await loadRollbackRules(db, s.problemId);
  const problemDefinition = withRollbackRules(
    toEngineProblemDefinition('pinned', definition, chunkRows.length),
    rules,
  );
  const workspace = normalizeWorkspace(s.workspaceState, definition.workspace_slots);
  const stored = s.publicState as PublicSession | null;

  return buildPublicSession({
    sessionId: s.id,
    stateVersion: s.stateVersion,
    status: s.status as 'ACTIVE' | 'COMPLETED' | 'ABANDONED',
    engineVersion: s.engineVersion,
    contentVersion: s.contentVersion,
    currentChunkIndex: s.currentChunkIndex,
    workspaceSlots: definition.workspace_slots,
    workspace,
    acceptedCommitments: s.acceptedCommitments as string[],
    chunks: chunkRows,
    message: workspace.pending_acknowledgment?.message ?? stored?.message ?? null,
    guidanceCode: stored?.guidance_code ?? null,
    problemDefinition,
  });
}

/**
 * Submit one structured action inside the ARCHITECTURE §8 transaction:
 * idempotency → row lock → ownership → version compare → pure engine →
 * atomic persistence of attempt + events + session state (+ rollback_logs).
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
    const rules = await loadRollbackRules(tx, s.problemId);
    const problemDefinition = withRollbackRules(
      toEngineProblemDefinition('pinned', definition, chunkRows.length),
      rules,
    );
    const priorMisconceptionCounts = await countPriorMisconceptions(tx, sessionId);

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
    const currentWorkspace = normalizeWorkspace(s.workspaceState, definition.workspace_slots);
    if (req.expected_state_version !== s.stateVersion) {
      const current = buildPublicSession({
        ...baseSerialize,
        stateVersion: s.stateVersion,
        status: 'ACTIVE',
        currentChunkIndex: s.currentChunkIndex,
        workspace: currentWorkspace,
        acceptedCommitments: s.acceptedCommitments as string[],
        message:
          currentWorkspace.pending_acknowledgment?.message ??
          'The session changed. Reloaded current state.',
        guidanceCode: null,
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
      workspace: currentWorkspace,
      accepted_commitments: s.acceptedCommitments as string[],
    };
    const result = applyAction({
      problemDefinition,
      sessionState: engineState,
      action: { action_type: req.action_type, payload: req.payload },
      priorMisconceptionCounts,
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
        guidanceCode: result.guidance_code,
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
        rollbackDepth: null,
      });

      // Test-only fault injection point: throwing here must roll back the whole
      // unit (state update + attempt + events). No-op in production.
      await runPostAcceptWriteHook();

      return { kind: 'APPLIED', session: publicSession };
    }

    // REJECTED semantic action — recorded. Guidance/acknowledgment/rollback may
    // still update durable state without advancing reveal forward (ARCHITECTURE §8).
    const stateChanged =
      result.nextState.current_chunk_index !== engineState.current_chunk_index ||
      JSON.stringify(result.nextState.accepted_commitments) !==
        JSON.stringify(engineState.accepted_commitments) ||
      JSON.stringify(result.nextState.workspace) !== JSON.stringify(engineState.workspace);

    let stateVersion = s.stateVersion;
    if (stateChanged) {
      stateVersion = s.stateVersion + 1;
    }

    const publicSession = buildPublicSession({
      ...baseSerialize,
      stateVersion,
      status: 'ACTIVE',
      currentChunkIndex: result.nextState.current_chunk_index,
      workspace: result.nextState.workspace,
      acceptedCommitments: result.nextState.accepted_commitments,
      message: result.message,
      guidanceCode: result.guidance_code,
    });

    // Always persist publicState on reject so the latest server message /
    // guidance survives resume (J-06 instruction display). Durable chunk /
    // workspace / version only bump when stateChanged.
    await tx
      .update(learningSessions)
      .set({
        ...(stateChanged
          ? {
              stateVersion,
              currentChunkIndex: result.nextState.current_chunk_index,
              workspaceState: result.nextState.workspace,
              acceptedCommitments: result.nextState.accepted_commitments,
            }
          : {}),
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
      stateVersionAfter: stateChanged ? stateVersion : null,
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
      rollbackDepth: result.rollback?.rollback_depth ?? null,
    });

    // (12) Insert rollback_logs when applicable — unique on attempt_id (AC-032).
    if (result.rollback) {
      await tx.insert(rollbackLogs).values({
        sessionId,
        attemptId,
        misconceptionCode: result.rollback.misconception_code,
        fromChunkIndex: result.rollback.from_chunk_index,
        toChunkIndex: result.rollback.to_chunk_index,
        rollbackDepth: result.rollback.rollback_depth,
        repeatCount: result.rollback.repeat_count,
        guidanceCode: result.rollback.guidance_code,
      });
    }

    // Fault injection covers rollback-path atomicity too (state + attempt +
    // events + rollback_logs). No-op in production.
    await runPostAcceptWriteHook();

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

async function loadRollbackRules(
  exec: Executor,
  problemId: string,
): Promise<EngineProblemDefinition['rollback_rules']> {
  const rows = await exec
    .select({
      misconceptionCode: rollbackRules.misconceptionCode,
      repeatFrom: rollbackRules.repeatFrom,
      rollbackDepth: rollbackRules.rollbackDepth,
      guidanceCode: rollbackRules.guidanceCode,
    })
    .from(rollbackRules)
    .where(eq(rollbackRules.problemId, problemId));
  return rows.map((r) => ({
    misconception_code: r.misconceptionCode,
    repeat_from: r.repeatFrom,
    rollback_depth: r.rollbackDepth,
    guidance_code: r.guidanceCode,
  }));
}

function withRollbackRules(
  def: EngineProblemDefinition,
  rules: EngineProblemDefinition['rollback_rules'],
): EngineProblemDefinition {
  return { ...def, rollback_rules: rules };
}

/**
 * Count prior completed REJECTED attempts that carried a misconception code.
 * The current attempt is not included — the engine adds 1 (AC-031).
 */
async function countPriorMisconceptions(
  exec: Executor,
  sessionId: string,
): Promise<Record<string, number>> {
  const rows = await exec
    .select({
      misconceptionCode: stageAttempts.misconceptionCode,
      count: sql<number>`count(*)::int`,
    })
    .from(stageAttempts)
    .where(
      and(
        eq(stageAttempts.sessionId, sessionId),
        eq(stageAttempts.outcome, 'REJECTED'),
        isNotNull(stageAttempts.completedAt),
        isNotNull(stageAttempts.misconceptionCode),
      ),
    )
    .groupBy(stageAttempts.misconceptionCode);

  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (row.misconceptionCode) {
      counts[row.misconceptionCode] = Number(row.count);
    }
  }
  return counts;
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
    rollbackDepth: number | null;
  },
): Promise<void> {
  for (const ev of args.events) {
    const isRollback = ev.event_type === 'ROLLBACK_APPLIED';
    await tx.insert(learningEvents).values({
      sessionId: args.sessionId,
      attemptId: args.attemptId,
      analyticsSubjectId: args.analyticsSubjectId,
      problemId: args.problemId,
      eventType: ev.event_type,
      payload: ev.payload,
      misconceptionCode: ev.misconception_code,
      rollbackDepth: isRollback ? args.rollbackDepth : null,
      engineVersion: args.engineVersion,
      contentVersion: args.contentVersion,
    });
  }
}
