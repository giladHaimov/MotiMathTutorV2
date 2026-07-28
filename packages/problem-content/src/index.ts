import type { EngineProblemDefinition } from '@app/engine';
import { definitionSchema, type ProblemDefinitionFixture } from './schema.js';

export * from './schema.js';
export { loadCanonicalFixtures, fixturesDir } from './fixtures/index.js';

/**
 * Project a stored problem `definition` (+ chunk count) into the shape the
 * pure engine consumes. Keeps the engine free of content-schema details.
 * `expected_final_result` stays server-only (never passed through the public
 * serializer allowlist). Re-parses so older jsonb rows still get schema defaults.
 */
export function toEngineProblemDefinition(
  problemKey: string,
  definition: ProblemDefinitionFixture | unknown,
  chunkCount: number,
): EngineProblemDefinition {
  const parsed = definitionSchema.parse(definition);
  return {
    problem_key: problemKey,
    workspace_slots: parsed.workspace_slots,
    steps: parsed.steps.map((s) => ({
      step_pos: s.step_pos,
      token_id: s.token_id,
      correct_slot: s.correct_slot,
      requires_revealed_chunk_index: s.requires_revealed_chunk_index,
      label: s.label,
      options: s.options.map((o) => ({
        slot: o.slot,
        label: o.label,
        misconception_code: o.misconception_code ?? null,
      })),
    })),
    fact_establishments: parsed.fact_establishments.map((f) => ({
      fact: f.fact,
      revealed_at_chunk_index: f.revealed_at_chunk_index,
    })),
    sufficiency_dependencies: parsed.sufficiency_dependencies.map((d) => ({
      action_type: d.action_type,
      requires_facts: [...d.requires_facts],
      misconception_code: d.misconception_code,
      requires_acknowledgment: d.requires_acknowledgment,
      message: d.message,
    })),
    chunk_count: chunkCount,
    gates: parsed.gates.map((g) => ({
      reveals_chunk_index: g.reveals_chunk_index,
      requires_commitment: g.requires_commitment,
    })),
    completion_rule: {
      requires_slots_filled: [...parsed.completion_rule.requires_slots_filled],
    },
    expected_final_result: {
      value: parsed.expected_final_result.value,
      unit: parsed.expected_final_result.unit,
    },
    // Rollback rules live in the `rollback_rules` table; the session service
    // merges the pinned problem's rules before calling the engine.
    rollback_rules: [],
  };
}
