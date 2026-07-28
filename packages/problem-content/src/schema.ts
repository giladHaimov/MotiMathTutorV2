import { z } from 'zod';
import { slotSchema } from '@app/contracts';

/**
 * Canonical problem-fixture schema (ARCHITECTURE §12). Fixtures are validated
 * before import (AC-008) and become immutable versioned content (PB-034).
 *
 * Gate/content integrity rejects fixtures that can skip, duplicate, suppress, or
 * deadlock progressive reveal (Slice 02).
 */

export const DOMAINS = ['PERCENT', 'RATIO', 'FRACTION'] as const;
export const domainSchema = z.enum(DOMAINS);

export const CHUNK_TYPES = ['CONTEXT', 'FACT', 'QUESTION'] as const;
export const chunkTypeSchema = z.enum(CHUNK_TYPES);

export const STATUSES = ['DRAFT', 'ACTIVE', 'RETIRED'] as const;
export const statusSchema = z.enum(STATUSES);

export const tokenSchema = z
  .object({
    token_id: z.string().min(1),
    text: z.string().min(1),
    role: z.string().min(1),
  })
  .strict();

export const chunkSchema = z
  .object({
    order_index: z.number().int().min(0),
    chunk_type: chunkTypeSchema,
    content: z.string().min(1),
    tokens: z.array(tokenSchema),
    semantic_definition: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

/** One selectable answer choice for a step (ARCHITECTURE §7.1 "Answer options"). */
export const stepOptionSchema = z
  .object({
    slot: slotSchema,
    label: z.string().min(1),
    /** Set on wrong options to classify the resulting misconception; omitted for the correct option. */
    misconception_code: z.string().min(1).optional(),
  })
  .strict();

/**
 * One ordered reasoning step (change-28-jul.txt). `step_pos` fixes the
 * problem's linear step order; `correct_slot` is the one correct answer
 * (never serialized to the client pre-submission); `options` is the full
 * authored answer set shown to the student for this step.
 */
export const stepSchema = z
  .object({
    step_pos: z.number().int().min(1),
    token_id: z.string().min(1),
    correct_slot: slotSchema,
    requires_revealed_chunk_index: z.number().int().min(0),
    label: z.string().min(1),
    options: z.array(stepOptionSchema).min(2),
  })
  .strict();

/**
 * Data-driven semantic sufficiency (ARCHITECTURE §12 / Slice 03).
 * A fact becomes established once its `revealed_at_chunk_index` is visible.
 * Premature actions that require missing facts are classified and may require
 * explicit acknowledgment before any further progressing action.
 */
export const factEstablishmentSchema = z
  .object({
    fact: z.string().min(1),
    revealed_at_chunk_index: z.number().int().min(0),
  })
  .strict();

export const sufficiencyDependencySchema = z
  .object({
    action_type: z.enum(['SUBMIT_FINAL_ANSWER']),
    requires_facts: z.array(z.string().min(1)).min(1),
    misconception_code: z.string().min(1),
    requires_acknowledgment: z.boolean(),
    message: z.string().min(1),
  })
  .strict();

export const definitionSchema = z
  .object({
    workspace_slots: z.array(slotSchema).min(1),
    steps: z.array(stepSchema).min(1),
    fact_establishments: z.array(factEstablishmentSchema).default([]),
    sufficiency_dependencies: z.array(sufficiencyDependencySchema).default([]),
    gates: z
      .array(
        z
          .object({
            reveals_chunk_index: z.number().int().min(1),
            requires_commitment: z.string().min(1),
          })
          .strict(),
      )
      .default([]),
    completion_rule: z
      .object({ requires_slots_filled: z.array(slotSchema) })
      .strict()
      .default({ requires_slots_filled: [] }),
    expected_final_result: z.object({ value: z.string().min(1), unit: z.string().min(1) }).strict(),
  })
  .strict();

export const rollbackRuleSchema = z
  .object({
    misconception_code: z.string().min(1),
    repeat_from: z.number().int().min(1),
    rollback_depth: z.number().int().min(0),
    guidance_code: z.string().min(1),
  })
  .strict();

export const misconceptionClassSchema = z
  .object({
    code: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
  })
  .strict();

export const programSchema = z
  .object({
    slug: z.string().min(1),
    name: z.string().min(1),
    version: z.number().int().positive(),
    status: statusSchema,
  })
  .strict();

export const problemFixtureSchema = z
  .object({
    program: programSchema,
    problem: z
      .object({
        problem_key: z.string().min(1),
        version: z.number().int().positive(),
        domain: domainSchema,
        title: z.string().min(1),
        difficulty_level: z.number().int().min(1).max(10),
        full_text: z.string().min(1),
        status: statusSchema,
        definition: definitionSchema,
        chunks: z.array(chunkSchema).min(1),
      })
      .strict()
      .superRefine((problem, ctx) => {
        const lastChunkIndex = problem.chunks.length - 1;
        const orderIndexes = problem.chunks.map((c) => c.order_index).sort((a, b) => a - b);
        orderIndexes.forEach((idx, i) => {
          if (idx !== i) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `chunk order_index must be contiguous from 0; found ${orderIndexes.join(',')}`,
            });
          }
        });

        // Unique token IDs across chunks.
        const tokenChunkIndex = new Map<string, number>();
        for (const chunk of problem.chunks) {
          for (const token of chunk.tokens) {
            if (tokenChunkIndex.has(token.token_id)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `duplicate token_id ${token.token_id} across chunks`,
              });
            } else {
              tokenChunkIndex.set(token.token_id, chunk.order_index);
            }
          }
        }

        // Unique step token IDs, unique step correct_slot values, unique/contiguous step_pos.
        const stepTokenIds = new Set<string>();
        const stepSlots = new Set<string>();
        const stepPositions = new Set<number>();
        for (const step of problem.definition.steps) {
          if (stepTokenIds.has(step.token_id)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `duplicate step token_id ${step.token_id}`,
            });
          }
          stepTokenIds.add(step.token_id);

          if (stepSlots.has(step.correct_slot)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `duplicate step correct_slot ${step.correct_slot}`,
            });
          }
          stepSlots.add(step.correct_slot);

          if (stepPositions.has(step.step_pos)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `duplicate step step_pos ${step.step_pos}`,
            });
          }
          stepPositions.add(step.step_pos);

          const correctOptions = step.options.filter((o) => o.slot === step.correct_slot);
          if (correctOptions.length !== 1) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `step ${step.token_id} must have exactly one option matching correct_slot ${step.correct_slot}; found ${correctOptions.length}`,
            });
          }
          const optionSlots = new Set<string>();
          for (const option of step.options) {
            if (optionSlots.has(option.slot)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `step ${step.token_id} has duplicate option slot ${option.slot}`,
              });
            }
            optionSlots.add(option.slot);
          }

          if (!tokenChunkIndex.has(step.token_id)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `step token_id ${step.token_id} is not defined in any chunk`,
            });
            continue;
          }
          if (step.requires_revealed_chunk_index > lastChunkIndex) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `step ${step.token_id} requires a chunk index beyond the problem`,
            });
          }
          // Reveal requirement must match the chunk that actually owns the token.
          const tokenChunk = tokenChunkIndex.get(step.token_id)!;
          if (step.requires_revealed_chunk_index !== tokenChunk) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `step ${step.token_id} requires_revealed_chunk_index ${step.requires_revealed_chunk_index} must equal token chunk ${tokenChunk}`,
            });
          }
        }

        // step_pos must be contiguous starting at 1 (goal #1: an explicit ordered flow).
        const sortedPositions = [...stepPositions].sort((a, b) => a - b);
        const expectedPositions = problem.definition.steps.map((_, i) => i + 1);
        const positionsContiguous =
          sortedPositions.length === expectedPositions.length &&
          sortedPositions.every((v, i) => v === expectedPositions[i]);
        if (!positionsContiguous) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `step_pos must be contiguous from 1; found ${sortedPositions.join(',') || '(none)'}`,
          });
        }

        const gates = problem.definition.gates;
        const revealIndexes = gates.map((g) => g.reveals_chunk_index);
        const commitmentIds = gates.map((g) => g.requires_commitment);

        // Unique commitment IDs.
        const seenCommitments = new Set<string>();
        for (const code of commitmentIds) {
          if (seenCommitments.has(code)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `duplicate gate commitment ${code}`,
            });
          }
          seenCommitments.add(code);
        }

        // Unique reveal indices; each within valid chunk bounds (1..last).
        const seenReveals = new Set<number>();
        for (const reveal of revealIndexes) {
          if (reveal > lastChunkIndex) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `gate reveals_chunk_index ${reveal} is beyond last chunk index ${lastChunkIndex}`,
            });
          }
          if (seenReveals.has(reveal)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `duplicate gate reveals_chunk_index ${reveal}`,
            });
          }
          seenReveals.add(reveal);
        }

        // Contiguous reveal progression 1..lastChunkIndex — no skip/suppress/deadlock.
        // With only commitment-gated reveal, every intermediate chunk must be gated.
        if (lastChunkIndex >= 1) {
          const expected = Array.from({ length: lastChunkIndex }, (_, i) => i + 1);
          const sorted = [...revealIndexes].sort((a, b) => a - b);
          const matches =
            sorted.length === expected.length && sorted.every((v, i) => v === expected[i]);
          if (!matches) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `gates must reveal chunks contiguously as ${expected.join(',')}; found ${sorted.join(',') || '(none)'}`,
            });
          }
        } else if (gates.length > 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'single-chunk problems must not define reveal gates',
          });
        }

        // Each gate commitment references a valid step at the prior chunk
        // (position-derived prerequisite): gate revealing K needs ≥1 step
        // with requires_revealed_chunk_index === K-1. Otherwise the gate deadlocks.
        for (const gate of gates) {
          const prerequisiteIndex = gate.reveals_chunk_index - 1;
          const hasStep = problem.definition.steps.some(
            (s) => s.requires_revealed_chunk_index === prerequisiteIndex,
          );
          if (!hasStep) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `gate commitment ${gate.requires_commitment} revealing chunk ${gate.reveals_chunk_index} has no step at chunk ${prerequisiteIndex}`,
            });
          }
        }

        // Fact establishments must reference valid chunk indexes; facts named by
        // sufficiency dependencies must be defined.
        const factNames = new Set<string>();
        for (const est of problem.definition.fact_establishments) {
          if (est.revealed_at_chunk_index > lastChunkIndex) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `fact ${est.fact} revealed_at_chunk_index ${est.revealed_at_chunk_index} is beyond last chunk index ${lastChunkIndex}`,
            });
          }
          if (factNames.has(est.fact)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `duplicate fact establishment ${est.fact}`,
            });
          }
          factNames.add(est.fact);
        }
        for (const dep of problem.definition.sufficiency_dependencies) {
          for (const fact of dep.requires_facts) {
            if (!factNames.has(fact)) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `sufficiency dependency requires unknown fact ${fact}`,
              });
            }
          }
        }
      }),
    misconception_classes: z.array(misconceptionClassSchema),
    rollback_rules: z.array(rollbackRuleSchema),
  })
  .strict();

export type ProblemFixture = z.infer<typeof problemFixtureSchema>;
export type ProblemDefinitionFixture = z.infer<typeof definitionSchema>;

/** Validate a raw fixture, throwing a readable error on the first problem. */
export function parseFixture(raw: unknown): ProblemFixture {
  return problemFixtureSchema.parse(raw);
}
