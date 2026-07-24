import { z } from 'zod';
import { slotSchema } from '@app/contracts';

/**
 * Canonical problem-fixture schema (ARCHITECTURE §12). Fixtures are validated
 * before import (AC-008) and become immutable versioned content (PB-034).
 *
 * NOTE: The full shape is authored for every canonical example so it validates
 * and imports, but Slice 01 only exercises the `definition.assignable` +
 * `workspace_slots` path through the pure engine.
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

export const assignableSchema = z
  .object({
    token_id: z.string().min(1),
    slot: slotSchema,
    requires_revealed_chunk_index: z.number().int().min(0),
    label: z.string().min(1),
  })
  .strict();

export const invalidAssignmentSchema = z
  .object({
    token_id: z.string().min(1),
    slot: slotSchema,
    misconception_code: z.string().min(1),
  })
  .strict();

export const definitionSchema = z
  .object({
    workspace_slots: z.array(slotSchema).min(1),
    assignable: z.array(assignableSchema),
    // Forward-looking fields (later slices); present so canonical content is complete.
    invalid_assignments: z.array(invalidAssignmentSchema).default([]),
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
      // Every assignable/token reference must point at a real, ordered chunk token.
      .superRefine((problem, ctx) => {
        const orderIndexes = problem.chunks.map((c) => c.order_index).sort((a, b) => a - b);
        orderIndexes.forEach((idx, i) => {
          if (idx !== i) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `chunk order_index must be contiguous from 0; found ${orderIndexes.join(',')}`,
            });
          }
        });
        const tokenIds = new Set(problem.chunks.flatMap((c) => c.tokens.map((t) => t.token_id)));
        for (const a of problem.definition.assignable) {
          if (!tokenIds.has(a.token_id)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `assignable token_id ${a.token_id} is not defined in any chunk`,
            });
          }
          if (a.requires_revealed_chunk_index > problem.chunks.length - 1) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `assignable ${a.token_id} requires a chunk index beyond the problem`,
            });
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
