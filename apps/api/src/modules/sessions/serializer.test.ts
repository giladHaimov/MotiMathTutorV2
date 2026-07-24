import { describe, expect, it } from 'vitest';
import type { EngineProblemDefinition } from '@app/engine';
import { buildPublicSession, type SerializeInput } from './serializer.js';

const problemDefinition: EngineProblemDefinition = {
  problem_key: 'EX-01',
  workspace_slots: ['WHOLE', 'PART_IN_PERCENTAGE', 'PART_IN_NUMBER', 'UNKNOWN'],
  assignable: [
    {
      token_id: 'ex01-c0-whole',
      slot: 'WHOLE',
      requires_revealed_chunk_index: 0,
      label: '40 students',
    },
    {
      token_id: 'ex01-c1-percent',
      slot: 'PART_IN_PERCENTAGE',
      requires_revealed_chunk_index: 1,
      label: '30%',
    },
    {
      token_id: 'ex01-c2-unknown',
      slot: 'UNKNOWN',
      requires_revealed_chunk_index: 2,
      label: 'students who wear glasses',
    },
  ],
  invalid_assignments: [
    {
      token_id: 'ex01-c1-percent',
      slot: 'WHOLE',
      misconception_code: 'WHOLE_PART_CONFUSION',
    },
  ],
  fact_establishments: [],
  sufficiency_dependencies: [],
  chunk_count: 3,
  gates: [
    { reveals_chunk_index: 1, requires_commitment: 'WHOLE_IDENTIFIED' },
    { reveals_chunk_index: 2, requires_commitment: 'PART_PERCENTAGE_IDENTIFIED' },
  ],
  completion_rule: { requires_slots_filled: ['WHOLE', 'PART_IN_PERCENTAGE', 'UNKNOWN'] },
  expected_final_result: { value: '12', unit: 'students' },
};

const baseInput: SerializeInput = {
  sessionId: '11111111-1111-1111-1111-111111111111',
  stateVersion: 0,
  status: 'ACTIVE',
  engineVersion: '1.0.0',
  contentVersion: 1,
  currentChunkIndex: 0,
  workspaceSlots: ['WHOLE', 'PART_IN_PERCENTAGE', 'PART_IN_NUMBER', 'UNKNOWN'],
  workspace: {
    slots: [
      { slot: 'WHOLE', token_id: null, label: null },
      { slot: 'PART_IN_PERCENTAGE', token_id: null, label: null },
      { slot: 'PART_IN_NUMBER', token_id: null, label: null },
      { slot: 'UNKNOWN', token_id: null, label: null },
    ],
    pending_acknowledgment: null,
  },
  acceptedCommitments: [],
  chunks: [
    {
      orderIndex: 0,
      chunkType: 'CONTEXT',
      content: 'A class has 40 students.',
      tokens: [{ token_id: 'ex01-c0-whole', text: '40 students' }],
    },
    {
      orderIndex: 1,
      chunkType: 'FACT',
      content: 'Thirty percent wear glasses.',
      tokens: [{ token_id: 'ex01-c1-percent', text: '30%' }],
    },
    {
      orderIndex: 2,
      chunkType: 'QUESTION',
      content: 'How many students wear glasses?',
      tokens: [{ token_id: 'ex01-c2-unknown', text: 'students who wear glasses' }],
    },
  ],
  message: null,
  problemDefinition,
};

describe('buildPublicSession (allowlist serializer)', () => {
  it('exposes only revealed chunks — never future hidden chunks (AC-012)', () => {
    const publicSession = buildPublicSession(baseInput);
    expect(publicSession.visible_chunks.map((c) => c.order_index)).toEqual([0]);
    const serialized = JSON.stringify(publicSession);
    expect(serialized).not.toContain('Thirty percent');
    expect(serialized).not.toContain('How many students');
    expect(serialized).not.toContain('expected_final_result');
    expect(serialized).not.toContain('"12"');
  });

  it('reveals up to the current chunk index', () => {
    const publicSession = buildPublicSession({ ...baseInput, currentChunkIndex: 1 });
    expect(publicSession.visible_chunks.map((c) => c.order_index)).toEqual([0, 1]);
    expect(JSON.stringify(publicSession)).not.toContain('How many students');
  });

  it('projects every workspace slot defined by the problem version', () => {
    const publicSession = buildPublicSession(baseInput);
    expect(publicSession.workspace.slots.map((s) => s.slot)).toEqual([
      'WHOLE',
      'PART_IN_PERCENTAGE',
      'PART_IN_NUMBER',
      'UNKNOWN',
    ]);
  });

  it('offers no actions once the session is not active', () => {
    const publicSession = buildPublicSession({ ...baseInput, status: 'COMPLETED' });
    expect(publicSession.allowed_actions).toEqual([]);
    expect(publicSession.required_next_action).toEqual({ action_type: null });
  });

  it('reflects ASSIGN_SLOT at stage 0 and never final answer before gates', () => {
    const publicSession = buildPublicSession(baseInput);
    expect(publicSession.allowed_actions).toEqual(['ASSIGN_SLOT']);
    expect(publicSession.required_next_action).toEqual({ action_type: 'ASSIGN_SLOT' });
    expect(publicSession.allowed_actions).not.toContain('SUBMIT_FINAL_ANSWER');
  });

  it('reflects SUBMIT_COMMITMENT after Whole is filled', () => {
    const publicSession = buildPublicSession({
      ...baseInput,
      stateVersion: 1,
      workspace: {
        slots: [
          { slot: 'WHOLE', token_id: 'ex01-c0-whole', label: '40 students' },
          { slot: 'PART_IN_PERCENTAGE', token_id: null, label: null },
          { slot: 'PART_IN_NUMBER', token_id: null, label: null },
          { slot: 'UNKNOWN', token_id: null, label: null },
        ],
        pending_acknowledgment: null,
      },
    });
    expect(publicSession.allowed_actions).toContain('SUBMIT_COMMITMENT');
    expect(publicSession.required_next_action).toEqual({ action_type: 'SUBMIT_COMMITMENT' });
    expect(publicSession.allowed_actions).not.toContain('SUBMIT_FINAL_ANSWER');
  });

  it('reflects SUBMIT_FINAL_ANSWER only when last chunk + completion slots filled', () => {
    const publicSession = buildPublicSession({
      ...baseInput,
      currentChunkIndex: 2,
      acceptedCommitments: ['WHOLE_IDENTIFIED', 'PART_PERCENTAGE_IDENTIFIED'],
      workspace: {
        slots: [
          { slot: 'WHOLE', token_id: 'ex01-c0-whole', label: '40 students' },
          { slot: 'PART_IN_PERCENTAGE', token_id: 'ex01-c1-percent', label: '30%' },
          { slot: 'PART_IN_NUMBER', token_id: null, label: null },
          { slot: 'UNKNOWN', token_id: 'ex01-c2-unknown', label: 'students who wear glasses' },
        ],
        pending_acknowledgment: null,
      },
    });
    expect(publicSession.allowed_actions).toContain('SUBMIT_FINAL_ANSWER');
    expect(publicSession.required_next_action).toEqual({ action_type: 'SUBMIT_FINAL_ANSWER' });
    expect(JSON.stringify(publicSession)).not.toContain('expected_final_result');
  });
});
