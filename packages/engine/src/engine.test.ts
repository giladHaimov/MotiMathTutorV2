import { describe, expect, it } from 'vitest';
import {
  applyAction,
  computeAllowedActions,
  computeRequiredNextAction,
  type EngineProblemDefinition,
  type EngineSessionState,
} from './index.js';

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
    {
      token_id: 'ex01-c2-unknown',
      slot: 'UNKNOWN',
      requires_revealed_chunk_index: 2,
      label: 'students who wear glasses',
    },
  ],
  chunk_count: 3,
  gates: [
    { reveals_chunk_index: 1, requires_commitment: 'WHOLE_IDENTIFIED' },
    { reveals_chunk_index: 2, requires_commitment: 'PART_PERCENTAGE_IDENTIFIED' },
  ],
  completion_rule: { requires_slots_filled: ['WHOLE', 'PART_IN_PERCENTAGE', 'UNKNOWN'] },
  expected_final_result: { value: '12', unit: 'students' },
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

function assign(
  state: EngineSessionState,
  slot: 'WHOLE' | 'PART_IN_PERCENTAGE' | 'UNKNOWN',
  token_id: string,
): EngineSessionState {
  const result = applyAction({
    problemDefinition: def,
    sessionState: state,
    action: { action_type: 'ASSIGN_SLOT', payload: { slot, token_id } },
  });
  expect(result.outcome).toBe('ACCEPTED');
  return result.nextState;
}

function commit(state: EngineSessionState): EngineSessionState {
  const result = applyAction({
    problemDefinition: def,
    sessionState: state,
    action: { action_type: 'SUBMIT_COMMITMENT', payload: {} },
  });
  expect(result.outcome).toBe('ACCEPTED');
  return result.nextState;
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

  it('rejects premature commitment when required slots are empty (no mutation)', () => {
    const state = freshState();
    const result = applyAction({
      problemDefinition: def,
      sessionState: state,
      action: { action_type: 'SUBMIT_COMMITMENT', payload: {} },
    });
    expect(result.outcome).toBe('REJECTED');
    expect(result.nextState).toEqual(state);
    expect(result.nextState.current_chunk_index).toBe(0);
  });

  it('commitment advances reveal only when required slots are filled (AC-024)', () => {
    const withWhole = assign(freshState(), 'WHOLE', 'ex01-c0-whole');
    const result = applyAction({
      problemDefinition: def,
      sessionState: withWhole,
      action: { action_type: 'SUBMIT_COMMITMENT', payload: {} },
    });
    expect(result.outcome).toBe('ACCEPTED');
    expect(result.nextState.current_chunk_index).toBe(1);
    expect(result.nextState.accepted_commitments).toEqual(['WHOLE_IDENTIFIED']);
    expect(result.events[0]?.event_type).toBe('COMMITMENT_ACCEPTED');
    expect(result.events[0]?.chunk_index).toBe(1);
  });

  it('rejects commitment when there is no next gate', () => {
    let state = freshState();
    state = assign(state, 'WHOLE', 'ex01-c0-whole');
    state = commit(state);
    state = assign(state, 'PART_IN_PERCENTAGE', 'ex01-c1-percent');
    state = commit(state);
    state = assign(state, 'UNKNOWN', 'ex01-c2-unknown');
    const result = applyAction({
      problemDefinition: def,
      sessionState: state,
      action: { action_type: 'SUBMIT_COMMITMENT', payload: {} },
    });
    expect(result.outcome).toBe('REJECTED');
    expect(result.nextState.current_chunk_index).toBe(2);
  });

  it('final answer is unavailable before last-chunk + completion slots (AC-033)', () => {
    const early = applyAction({
      problemDefinition: def,
      sessionState: freshState(),
      action: { action_type: 'SUBMIT_FINAL_ANSWER', payload: { value: '12' } },
    });
    expect(early.outcome).toBe('REJECTED');
    expect(early.nextState.status).toBe('ACTIVE');

    let mid = assign(freshState(), 'WHOLE', 'ex01-c0-whole');
    mid = commit(mid);
    const midAnswer = applyAction({
      problemDefinition: def,
      sessionState: mid,
      action: { action_type: 'SUBMIT_FINAL_ANSWER', payload: { value: '12' } },
    });
    expect(midAnswer.outcome).toBe('REJECTED');
    expect(midAnswer.nextState.status).toBe('ACTIVE');
  });

  it('correct final answer completes the session (AC-034/036)', () => {
    let state = freshState();
    state = assign(state, 'WHOLE', 'ex01-c0-whole');
    state = commit(state);
    state = assign(state, 'PART_IN_PERCENTAGE', 'ex01-c1-percent');
    state = commit(state);
    state = assign(state, 'UNKNOWN', 'ex01-c2-unknown');

    const result = applyAction({
      problemDefinition: def,
      sessionState: state,
      action: { action_type: 'SUBMIT_FINAL_ANSWER', payload: { value: '12' } },
    });
    expect(result.outcome).toBe('ACCEPTED');
    expect(result.nextState.status).toBe('COMPLETED');
    expect(result.events[0]?.event_type).toBe('SESSION_COMPLETED');
  });

  it('wrong final answer is rejected without completing (AC-035)', () => {
    let state = freshState();
    state = assign(state, 'WHOLE', 'ex01-c0-whole');
    state = commit(state);
    state = assign(state, 'PART_IN_PERCENTAGE', 'ex01-c1-percent');
    state = commit(state);
    state = assign(state, 'UNKNOWN', 'ex01-c2-unknown');

    const result = applyAction({
      problemDefinition: def,
      sessionState: state,
      action: { action_type: 'SUBMIT_FINAL_ANSWER', payload: { value: '15' } },
    });
    expect(result.outcome).toBe('REJECTED');
    expect(result.nextState.status).toBe('ACTIVE');
    expect(result.events[0]?.event_type).toBe('FINAL_ANSWER_REJECTED');
  });

  it('accepts numeric-normalized final answers (trim / 12.0)', () => {
    let state = freshState();
    state = assign(state, 'WHOLE', 'ex01-c0-whole');
    state = commit(state);
    state = assign(state, 'PART_IN_PERCENTAGE', 'ex01-c1-percent');
    state = commit(state);
    state = assign(state, 'UNKNOWN', 'ex01-c2-unknown');

    const result = applyAction({
      problemDefinition: def,
      sessionState: state,
      action: { action_type: 'SUBMIT_FINAL_ANSWER', payload: { value: ' 12.0 ' } },
    });
    expect(result.outcome).toBe('ACCEPTED');
    expect(result.nextState.status).toBe('COMPLETED');
  });

  it('still rejects acknowledgment (Slice 03)', () => {
    const result = applyAction({
      problemDefinition: def,
      sessionState: freshState(),
      action: { action_type: 'ACKNOWLEDGE_INSUFFICIENT_INFORMATION', payload: {} },
    });
    expect(result.outcome).toBe('REJECTED');
  });
});

describe('computeAllowedActions / computeRequiredNextAction', () => {
  it('starts with ASSIGN_SLOT required and no commitment/final', () => {
    const state = freshState();
    expect(computeAllowedActions(def, state)).toEqual(['ASSIGN_SLOT']);
    expect(computeRequiredNextAction(def, state)).toEqual({ action_type: 'ASSIGN_SLOT' });
  });

  it('after Whole filled, commitment becomes available', () => {
    const state = assign(freshState(), 'WHOLE', 'ex01-c0-whole');
    const allowed = computeAllowedActions(def, state);
    expect(allowed).toContain('SUBMIT_COMMITMENT');
    expect(allowed).toContain('DELETE_ASSIGNMENT');
    expect(allowed).not.toContain('ASSIGN_SLOT');
    expect(allowed).not.toContain('SUBMIT_FINAL_ANSWER');
    expect(computeRequiredNextAction(def, state)).toEqual({ action_type: 'SUBMIT_COMMITMENT' });
  });

  it('at last chunk with slots filled, final answer is required', () => {
    let state = freshState();
    state = assign(state, 'WHOLE', 'ex01-c0-whole');
    state = commit(state);
    state = assign(state, 'PART_IN_PERCENTAGE', 'ex01-c1-percent');
    state = commit(state);
    state = assign(state, 'UNKNOWN', 'ex01-c2-unknown');

    const allowed = computeAllowedActions(def, state);
    expect(allowed).toContain('SUBMIT_FINAL_ANSWER');
    expect(allowed).not.toContain('SUBMIT_COMMITMENT');
    expect(computeRequiredNextAction(def, state)).toEqual({ action_type: 'SUBMIT_FINAL_ANSWER' });
  });

  it('returns no actions once completed', () => {
    let state = freshState();
    state = assign(state, 'WHOLE', 'ex01-c0-whole');
    state = commit(state);
    state = assign(state, 'PART_IN_PERCENTAGE', 'ex01-c1-percent');
    state = commit(state);
    state = assign(state, 'UNKNOWN', 'ex01-c2-unknown');
    const done = applyAction({
      problemDefinition: def,
      sessionState: state,
      action: { action_type: 'SUBMIT_FINAL_ANSWER', payload: { value: '12' } },
    }).nextState;
    expect(computeAllowedActions(def, done)).toEqual([]);
    expect(computeRequiredNextAction(def, done)).toEqual({ action_type: null });
  });

  it('is deterministic for identical inputs', () => {
    const state = assign(freshState(), 'WHOLE', 'ex01-c0-whole');
    expect(computeAllowedActions(def, state)).toEqual(computeAllowedActions(def, state));
    expect(computeRequiredNextAction(def, state)).toEqual(computeRequiredNextAction(def, state));
  });
});
