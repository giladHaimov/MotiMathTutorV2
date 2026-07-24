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

        // Unique assignable token IDs and unique assignable slot IDs.
        const assignableTokenIds = new Set<string>();
        const assignableSlots = new Set<string>();
        for (const a of problem.definition.assignable) {
          if (assignableTokenIds.has(a.token_id)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `duplicate assignable token_id ${a.token_id}`,
            });
          }
          assignableTokenIds.add(a.token_id);

          if (assignableSlots.has(a.slot)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `duplicate assignable slot ${a.slot}`,
            });
          }
          assignableSlots.add(a.slot);

          if (!tokenChunkIndex.has(a.token_id)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `assignable token_id ${a.token_id} is not defined in any chunk`,
            });
            continue;
          }
          if (a.requires_revealed_chunk_index > lastChunkIndex) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `assignable ${a.token_id} requires a chunk index beyond the problem`,
            });
          }
          // Reveal requirement must match the chunk that actually owns the token.
          const tokenChunk = tokenChunkIndex.get(a.token_id)!;
          if (a.requires_revealed_chunk_index !== tokenChunk) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `assignable ${a.token_id} requires_revealed_chunk_index ${a.requires_revealed_chunk_index} must equal token chunk ${tokenChunk}`,
            });
          }
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

        // Each gate commitment references a valid assignable at the prior chunk
        // (position-derived prerequisite): gate revealing K needs ≥1 assignable
        // with requires_revealed_chunk_index === K-1. Otherwise the gate deadlocks.
        for (const gate of gates) {
          const prerequisiteIndex = gate.reveals_chunk_index - 1;
          const hasAssignable = problem.definition.assignable.some(
            (a) => a.requires_revealed_chunk_index === prerequisiteIndex,
          );
          if (!hasAssignable) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: `gate commitment ${gate.requires_commitment} revealing chunk ${gate.reveals_chunk_index} has no assignable at chunk ${prerequisiteIndex}`,
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
