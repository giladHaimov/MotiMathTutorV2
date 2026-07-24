import { and, eq, ne } from 'drizzle-orm';
import { loadCanonicalFixtures, type ProblemFixture } from '@app/problem-content';
import type { Db } from '../../db/index.js';
import {
  chunks,
  misconceptionClasses,
  problems,
  programs,
  rollbackRules,
} from '../../db/schema/product.js';

export interface ImportSummary {
  programs: number;
  problems: number;
  chunks: number;
  misconceptionClasses: number;
  rollbackRules: number;
  skippedImmutable: number;
}

/**
 * Idempotent canonical content import (J-11 / PB-034).
 *
 * - Fixtures are validated before any insert (fail-before-partial-insert).
 * - Immutable versioned content: an existing (program, problem_key, version) is
 *   left untouched; re-import is a no-op.
 * - Runs inside a single transaction so a mid-import failure leaves no partial state.
 */
export async function importCanonicalContent(db: Db): Promise<ImportSummary> {
  // Validation happens here, before the transaction opens.
  const fixtures = loadCanonicalFixtures();

  const summary: ImportSummary = {
    programs: 0,
    problems: 0,
    chunks: 0,
    misconceptionClasses: 0,
    rollbackRules: 0,
    skippedImmutable: 0,
  };

  await db.transaction(async (tx) => {
    for (const fixture of fixtures) {
      await importOne(tx, fixture, summary);
    }
  });

  return summary;
}

async function importOne(
  tx: Parameters<Parameters<Db['transaction']>[0]>[0],
  fixture: ProblemFixture,
  summary: ImportSummary,
): Promise<void> {
  // Misconception classes — upsert by code (idempotent, shared across problems).
  for (const mc of fixture.misconception_classes) {
    await tx
      .insert(misconceptionClasses)
      .values({ code: mc.code, name: mc.name, description: mc.description })
      .onConflictDoUpdate({
        target: misconceptionClasses.code,
        set: { name: mc.name, description: mc.description },
      });
  }
  summary.misconceptionClasses = fixture.misconception_classes.length;

  // Program — find or create by (slug, version).
  const existingProgram = await tx
    .select({ id: programs.id })
    .from(programs)
    .where(
      and(eq(programs.slug, fixture.program.slug), eq(programs.version, fixture.program.version)),
    );
  let programId: string;
  if (existingProgram[0]) {
    programId = existingProgram[0].id;
  } else {
    const [row] = await tx
      .insert(programs)
      .values({
        slug: fixture.program.slug,
        name: fixture.program.name,
        version: fixture.program.version,
        status: fixture.program.status,
      })
      .returning({ id: programs.id });
    programId = row!.id;
    summary.programs += 1;
  }

  // Problem — immutable by (program_id, problem_key, version).
  const existingProblem = await tx
    .select({ id: problems.id })
    .from(problems)
    .where(
      and(
        eq(problems.programId, programId),
        eq(problems.problemKey, fixture.problem.problem_key),
        eq(problems.version, fixture.problem.version),
      ),
    );

  let problemId: string;
  if (existingProblem[0]) {
    // Already imported: do not mutate immutable content.
    summary.skippedImmutable += 1;
    problemId = existingProblem[0].id;
  } else {
    const [row] = await tx
      .insert(problems)
      .values({
        programId,
        problemKey: fixture.problem.problem_key,
        version: fixture.problem.version,
        domain: fixture.problem.domain,
        title: fixture.problem.title,
        difficultyLevel: fixture.problem.difficulty_level,
        fullText: fixture.problem.full_text,
        definition: fixture.problem.definition,
        status: fixture.problem.status,
      })
      .returning({ id: problems.id });
    problemId = row!.id;
    summary.problems += 1;

    // Activate this version for new sessions: retire older versions of the same
    // problem_key in this program (J-11). Existing sessions remain pinned.
    if (fixture.problem.status === 'ACTIVE') {
      await tx
        .update(problems)
        .set({ status: 'RETIRED' })
        .where(
          and(
            eq(problems.programId, programId),
            eq(problems.problemKey, fixture.problem.problem_key),
            eq(problems.status, 'ACTIVE'),
            ne(problems.id, problemId),
          ),
        );
    }

    // Chunks — store the tokens alongside the semantic definition so the public
    // serializer can expose only visible-chunk tokens.
    for (const c of fixture.problem.chunks) {
      await tx.insert(chunks).values({
        problemId,
        orderIndex: c.order_index,
        chunkType: c.chunk_type,
        content: c.content,
        semanticDefinition: { ...c.semantic_definition, tokens: c.tokens },
      });
      summary.chunks += 1;
    }
  }

  // Rollback rules — idempotent by (problem_id, misconception_code, repeat_from).
  for (const rule of fixture.rollback_rules) {
    await tx
      .insert(rollbackRules)
      .values({
        problemId,
        misconceptionCode: rule.misconception_code,
        repeatFrom: rule.repeat_from,
        rollbackDepth: rule.rollback_depth,
        guidanceCode: rule.guidance_code,
      })
      .onConflictDoNothing({
        target: [
          rollbackRules.problemId,
          rollbackRules.misconceptionCode,
          rollbackRules.repeatFrom,
        ],
      });
    summary.rollbackRules += 1;
  }
}
