import { describe, expect, it } from 'vitest';
import { parseFixture, type ProblemFixture } from './schema.js';

/** Minimal valid EX-style fixture used as a base for negative mutations. */
function validFixture(): ProblemFixture {
  return {
    program: {
      slug: 'core-reasoning',
      name: 'Core Reasoning MVP',
      version: 1,
      status: 'ACTIVE',
    },
    problem: {
      problem_key: 'EX-TEST',
      version: 1,
      domain: 'PERCENT',
      title: 'Schema integrity fixture',
      difficulty_level: 1,
      full_text: 'A class has 40 students. Thirty percent wear glasses. How many?',
      status: 'ACTIVE',
      definition: {
        workspace_slots: ['WHOLE', 'PART_IN_PERCENTAGE', 'UNKNOWN'],
        assignable: [
          {
            token_id: 't-whole',
            slot: 'WHOLE',
            requires_revealed_chunk_index: 0,
            label: '40 students',
          },
          {
            token_id: 't-percent',
            slot: 'PART_IN_PERCENTAGE',
            requires_revealed_chunk_index: 1,
            label: '30%',
          },
          {
            token_id: 't-unknown',
            slot: 'UNKNOWN',
            requires_revealed_chunk_index: 2,
            label: 'glasses wearers',
          },
        ],
        invalid_assignments: [],
        fact_establishments: [],
        sufficiency_dependencies: [],
        gates: [
          { reveals_chunk_index: 1, requires_commitment: 'WHOLE_IDENTIFIED' },
          { reveals_chunk_index: 2, requires_commitment: 'PART_PERCENTAGE_IDENTIFIED' },
        ],
        completion_rule: {
          requires_slots_filled: ['WHOLE', 'PART_IN_PERCENTAGE', 'UNKNOWN'],
        },
        expected_final_result: { value: '12', unit: 'students' },
      },
      chunks: [
        {
          order_index: 0,
          chunk_type: 'CONTEXT',
          content: 'A class has 40 students.',
          tokens: [{ token_id: 't-whole', text: '40 students', role: 'QUANTITY' }],
          semantic_definition: {},
        },
        {
          order_index: 1,
          chunk_type: 'FACT',
          content: 'Thirty percent wear glasses.',
          tokens: [{ token_id: 't-percent', text: '30%', role: 'PERCENTAGE' }],
          semantic_definition: {},
        },
        {
          order_index: 2,
          chunk_type: 'QUESTION',
          content: 'How many?',
          tokens: [{ token_id: 't-unknown', text: 'glasses wearers', role: 'UNKNOWN' }],
          semantic_definition: {},
        },
      ],
    },
    misconception_classes: [],
    rollback_rules: [],
  };
}

function expectReject(raw: unknown, message: RegExp): void {
  expect(() => parseFixture(raw)).toThrow(message);
}

describe('problem fixture gate/content integrity', () => {
  it('accepts a valid contiguous gated fixture', () => {
    expect(parseFixture(validFixture()).problem.problem_key).toBe('EX-TEST');
  });

  it('rejects gate reveal index beyond chunk bounds', () => {
    const raw = validFixture();
    raw.problem.definition.gates = [
      { reveals_chunk_index: 1, requires_commitment: 'WHOLE_IDENTIFIED' },
      { reveals_chunk_index: 3, requires_commitment: 'TOO_FAR' },
    ];
    expectReject(raw, /beyond last chunk index|contiguously/);
  });

  it('rejects duplicate gate reveal indices', () => {
    const raw = validFixture();
    raw.problem.definition.gates = [
      { reveals_chunk_index: 1, requires_commitment: 'A' },
      { reveals_chunk_index: 1, requires_commitment: 'B' },
    ];
    expectReject(raw, /duplicate gate reveals_chunk_index 1/);
  });

  it('rejects non-contiguous / skipped reveal progression', () => {
    const raw = validFixture();
    // Skip chunk 1 — would deadlock after chunk 0.
    raw.problem.definition.gates = [{ reveals_chunk_index: 2, requires_commitment: 'SKIPPED_ONE' }];
    expectReject(raw, /contiguously/);
  });

  it('rejects suppressed intermediate gate (missing final reveal)', () => {
    const raw = validFixture();
    raw.problem.definition.gates = [
      { reveals_chunk_index: 1, requires_commitment: 'WHOLE_IDENTIFIED' },
    ];
    expectReject(raw, /contiguously/);
  });

  it('rejects duplicate gate commitment IDs', () => {
    const raw = validFixture();
    raw.problem.definition.gates = [
      { reveals_chunk_index: 1, requires_commitment: 'SAME' },
      { reveals_chunk_index: 2, requires_commitment: 'SAME' },
    ];
    expectReject(raw, /duplicate gate commitment SAME/);
  });

  it('rejects duplicate assignable slot IDs', () => {
    const raw = validFixture();
    raw.problem.definition.assignable[1] = {
      token_id: 't-percent',
      slot: 'WHOLE',
      requires_revealed_chunk_index: 1,
      label: '30%',
    };
    expectReject(raw, /duplicate assignable slot WHOLE/);
  });

  it('rejects duplicate assignable token IDs', () => {
    const raw = validFixture();
    raw.problem.definition.assignable[1] = {
      token_id: 't-whole',
      slot: 'PART_IN_PERCENTAGE',
      requires_revealed_chunk_index: 1,
      label: '30%',
    };
    expectReject(raw, /duplicate assignable token_id t-whole/);
  });

  it('rejects gate commitment with no assignable at the prerequisite chunk', () => {
    const raw = validFixture();
    // Remove the chunk-0 assignable → gate revealing 1 deadlocks.
    raw.problem.definition.assignable = raw.problem.definition.assignable.filter(
      (a) => a.requires_revealed_chunk_index !== 0,
    );
    // Keep contiguous gates but break the prerequisite link.
    expectReject(raw, /has no assignable at chunk 0/);
  });

  it('rejects assignable reveal index that does not match token chunk position', () => {
    const raw = validFixture();
    raw.problem.definition.assignable[0] = {
      ...raw.problem.definition.assignable[0]!,
      requires_revealed_chunk_index: 1, // token lives in chunk 0
    };
    expectReject(raw, /must equal token chunk 0/);
  });

  it('rejects empty gates when multiple chunks exist (deadlock / suppress)', () => {
    const raw = validFixture();
    raw.problem.definition.gates = [];
    expectReject(raw, /contiguously/);
  });
});
