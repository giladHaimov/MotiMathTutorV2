import type { EngineProblemDefinition } from '@app/engine';
import type { ProblemDefinitionFixture } from './schema.js';

export * from './schema.js';
export { loadCanonicalFixtures, fixturesDir } from './fixtures/index.js';

/**
 * Project a stored problem `definition` (+ chunk count) into the shape the
 * pure engine consumes. Keeps the engine free of content-schema details.
 * `expected_final_result` stays server-only (never passed through the public
 * serializer allowlist).
 */
export function toEngineProblemDefinition(
  problemKey: string,
  definition: ProblemDefinitionFixture,
  chunkCount: number,
): EngineProblemDefinition {
  return {
    problem_key: problemKey,
    workspace_slots: definition.workspace_slots,
    assignable: definition.assignable.map((a) => ({
      token_id: a.token_id,
      slot: a.slot,
      requires_revealed_chunk_index: a.requires_revealed_chunk_index,
      label: a.label,
    })),
    chunk_count: chunkCount,
    gates: definition.gates.map((g) => ({
      reveals_chunk_index: g.reveals_chunk_index,
      requires_commitment: g.requires_commitment,
    })),
    completion_rule: {
      requires_slots_filled: [...definition.completion_rule.requires_slots_filled],
    },
    expected_final_result: {
      value: definition.expected_final_result.value,
      unit: definition.expected_final_result.unit,
    },
  };
}
