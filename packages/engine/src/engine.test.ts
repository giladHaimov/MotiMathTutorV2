import { describe, expect, it } from 'vitest';
import { applyAction, type EngineProblemDefinition, type EngineSessionState } from './index.js';

const def: EngineProblemDefinition = {
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
  ],
  chunk_count: 3,
};

function freshState(): EngineSessionState {
  return {
    status: 'ACTIVE',
    current_chunk_index: 0,
    workspace: {
      slots: [
        { slot: 'WHOLE', token_id: null, label: null },
        { slot: 'PART_IN_PERCENTAGE', token_id: null, label: null },
        { slot: 'PART_IN_NUMBER', token_id: null, label: null },
        { slot: 'UNKNOWN', token_id: null, label: null },
      ],
    },
    accepted_commitments: [],
  };
}

describe('engine.applyAction', () => {
  it('accepts a valid Whole assignment and does not advance the reveal', () => {
    const result = applyAction({
      problemDefinition: def,
      sessionState: freshState(),
      action: { action_type: 'ASSIGN_SLOT', payload: { slot: 'WHOLE', token_id: 'ex01-c0-whole' } },
    });
    expect(result.outcome).toBe('ACCEPTED');
    expect(result.nextState.workspace.slots.find((s) => s.slot === 'WHOLE')?.token_id).toBe(
      'ex01-c0-whole',
    );
    expect(result.nextState.current_chunk_index).toBe(0);
    expect(result.events[0]?.event_type).toBe('SLOT_ASSIGNED');
  });

  it('rejects placing a not-yet-revealed token without changing state', () => {
    const state = freshState();
    const result = applyAction({
      problemDefinition: def,
      sessionState: state,
      action: {
        action_type: 'ASSIGN_SLOT',
        payload: { slot: 'PART_IN_PERCENTAGE', token_id: 'ex01-c1-percent' },
      },
    });
    expect(result.outcome).toBe('REJECTED');
    expect(result.nextState).toEqual(state);
  });

  it('rejects an invalid token/slot pairing without silent correction (no state change)', () => {
    const state = freshState();
    const result = applyAction({
      problemDefinition: def,
      sessionState: state,
      action: {
        action_type: 'ASSIGN_SLOT',
        payload: { slot: 'WHOLE', token_id: 'ex01-c1-percent' },
      },
    });
    expect(result.outcome).toBe('REJECTED');
    expect(result.nextState.workspace.slots.find((s) => s.slot === 'WHOLE')?.token_id).toBeNull();
  });

  it('blocks assignment into an occupied slot until deletion', () => {
    const accepted = applyAction({
      problemDefinition: def,
      sessionState: freshState(),
      action: { action_type: 'ASSIGN_SLOT', payload: { slot: 'WHOLE', token_id: 'ex01-c0-whole' } },
    });
    const second = applyAction({
      problemDefinition: def,
      sessionState: accepted.nextState,
      action: { action_type: 'ASSIGN_SLOT', payload: { slot: 'WHOLE', token_id: 'ex01-c0-whole' } },
    });
    expect(second.outcome).toBe('REJECTED');
  });

  it('deletes an assignment and frees the slot', () => {
    const accepted = applyAction({
      problemDefinition: def,
      sessionState: freshState(),
      action: { action_type: 'ASSIGN_SLOT', payload: { slot: 'WHOLE', token_id: 'ex01-c0-whole' } },
    });
    const deleted = applyAction({
      problemDefinition: def,
      sessionState: accepted.nextState,
      action: { action_type: 'DELETE_ASSIGNMENT', payload: { slot: 'WHOLE' } },
    });
    expect(deleted.outcome).toBe('ACCEPTED');
    expect(deleted.nextState.workspace.slots.find((s) => s.slot === 'WHOLE')?.token_id).toBeNull();
  });

  it('is deterministic for identical inputs', () => {
    const a = applyAction({
      problemDefinition: def,
      sessionState: freshState(),
      action: { action_type: 'ASSIGN_SLOT', payload: { slot: 'WHOLE', token_id: 'ex01-c0-whole' } },
    });
    const b = applyAction({
      problemDefinition: def,
      sessionState: freshState(),
      action: { action_type: 'ASSIGN_SLOT', payload: { slot: 'WHOLE', token_id: 'ex01-c0-whole' } },
    });
    expect(a).toEqual(b);
  });

  it('does not allow later-slice actions yet', () => {
    for (const action_type of [
      'SUBMIT_COMMITMENT',
      'ACKNOWLEDGE_INSUFFICIENT_INFORMATION',
      'SUBMIT_FINAL_ANSWER',
    ] as const) {
      const result = applyAction({
        problemDefinition: def,
        sessionState: freshState(),
        action: { action_type, payload: {} },
      });
      expect(result.outcome).toBe('REJECTED');
    }
  });
});
