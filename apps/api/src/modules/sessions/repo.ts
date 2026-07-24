import { and, asc, eq, notInArray } from 'drizzle-orm';
import type { Slot } from '@app/contracts';
import type { WorkspaceState } from '@app/engine';
import type { ProblemDefinitionFixture } from '@app/problem-content';
import type { Db } from '../../db/index.js';
import { chunks, learningSessions, problems, programs } from '../../db/schema/product.js';
import type { ChunkRow } from './serializer.js';

/** Any drizzle executor (top-level db or a transaction). */
type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export interface SelectedProblem {
  id: string;
  problemKey: string;
  definition: ProblemDefinitionFixture;
  contentVersion: number;
}

/**
 * Deterministic next-problem selection (J-02, AC-014): active content only,
 * excluding problems the subject has already completed, ordered by a fixed rule.
 */
export async function pickNextProblem(db: Db, subjectId: string): Promise<SelectedProblem | null> {
  const completed = db
    .select({ pid: learningSessions.problemId })
    .from(learningSessions)
    .where(
      and(
        eq(learningSessions.analyticsSubjectId, subjectId),
        eq(learningSessions.status, 'COMPLETED'),
      ),
    );

  const rows = await db
    .select({
      id: problems.id,
      problemKey: problems.problemKey,
      definition: problems.definition,
      programVersion: programs.version,
    })
    .from(problems)
    .innerJoin(programs, eq(problems.programId, programs.id))
    .where(
      and(
        eq(problems.status, 'ACTIVE'),
        eq(programs.status, 'ACTIVE'),
        notInArray(problems.id, completed),
      ),
    )
    .orderBy(asc(problems.difficultyLevel), asc(problems.problemKey), asc(problems.version))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    problemKey: row.problemKey,
    definition: row.definition as ProblemDefinitionFixture,
    contentVersion: row.programVersion,
  };
}

/** Load ordered chunk rows for serialization (tokens live in semantic_definition). */
export async function loadChunkRows(exec: Executor, problemId: string): Promise<ChunkRow[]> {
  const rows = await exec
    .select({
      orderIndex: chunks.orderIndex,
      chunkType: chunks.chunkType,
      content: chunks.content,
      semanticDefinition: chunks.semanticDefinition,
    })
    .from(chunks)
    .where(eq(chunks.problemId, problemId))
    .orderBy(asc(chunks.orderIndex));

  return rows.map((r) => {
    const semantic = (r.semanticDefinition ?? {}) as {
      tokens?: Array<{ token_id: string; text: string }>;
    };
    return {
      orderIndex: r.orderIndex,
      chunkType: r.chunkType,
      content: r.content,
      tokens: (semantic.tokens ?? []).map((t) => ({ token_id: t.token_id, text: t.text })),
    };
  });
}

/** Fresh empty workspace with one entry per slot defined by the problem version. */
export function initialWorkspace(workspaceSlots: Slot[]): WorkspaceState {
  return {
    slots: workspaceSlots.map((slot) => ({ slot, token_id: null, label: null })),
    pending_acknowledgment: null,
  };
}

/** Normalize durable workspace jsonb (older rows may omit pending_acknowledgment). */
export function normalizeWorkspace(raw: unknown, workspaceSlots: Slot[]): WorkspaceState {
  const obj = (raw ?? {}) as {
    slots?: Array<{ slot: Slot; token_id: string | null; label: string | null }>;
    pending_acknowledgment?: WorkspaceState['pending_acknowledgment'];
  };
  const slots =
    obj.slots && obj.slots.length > 0
      ? obj.slots.map((s) => ({
          slot: s.slot,
          token_id: s.token_id ?? null,
          label: s.label ?? null,
        }))
      : workspaceSlots.map((slot) => ({ slot, token_id: null, label: null }));
  return {
    slots,
    pending_acknowledgment: obj.pending_acknowledgment ?? null,
  };
}
