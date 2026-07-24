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

const ratioDef: EngineProblemDefinition = {
  problem_key: 'EX-02',
  workspace_slots: ['RATIO', 'PART_IN_NUMBER', 'UNKNOWN'],
  assignable: [
    {
      token_id: 'ex02-c0-ratio',
      slot: 'RATIO',
      requires_revealed_chunk_index: 0,
      label: '2:3',
    },
    {
      token_id: 'ex02-c1-blue',
      slot: 'PART_IN_NUMBER',
      requires_revealed_chunk_index: 1,
      label: '15 blue marbles',
    },
    {
      token_id: 'ex02-c2-unknown',
      slot: 'UNKNOWN',
      requires_revealed_chunk_index: 2,
      label: 'red marbles',
    },
  ],
  invalid_assignments: [],
  fact_establishments: [
    { fact: 'RATIO', revealed_at_chunk_index: 0 },
    { fact: 'SCALE', revealed_at_chunk_index: 1 },
  ],
  sufficiency_dependencies: [
    {
      action_type: 'SUBMIT_FINAL_ANSWER',
      requires_facts: ['SCALE'],
      misconception_code: 'PREMATURE_QUANTIFICATION',
      requires_acknowledgment: true,
      message:
        'The scale is not known yet. Acknowledge that information is insufficient before continuing.',
    },
  ],
  chunk_count: 3,
  gates: [
    { reveals_chunk_index: 1, requires_commitment: 'RATIO_IDENTIFIED' },
    { reveals_chunk_index: 2, requires_commitment: 'SCALE_IDENTIFIED' },
  ],
  completion_rule: { requires_slots_filled: ['RATIO', 'PART_IN_NUMBER', 'UNKNOWN'] },
  expected_final_result: { value: '10', unit: 'red marbles' },
};

const fractionDef: EngineProblemDefinition = {
  problem_key: 'EX-03',
  workspace_slots: ['FRACTION', 'WHOLE', 'UNKNOWN'],
  assignable: [
    {
      token_id: 'ex03-c0-fraction',
      slot: 'FRACTION',
      requires_revealed_chunk_index: 0,
      label: 'three fifths (read)',
    },
    {
      token_id: 'ex03-c1-whole',
      slot: 'WHOLE',
      requires_revealed_chunk_index: 1,
      label: '50 pages',
    },
    {
      token_id: 'ex03-c2-unknown',
      slot: 'UNKNOWN',
      requires_revealed_chunk_index: 2,
      label: 'pages that remain unread',
    },
  ],
  invalid_assignments: [
    {
      token_id: 'ex03-c0-fraction',
      slot: 'UNKNOWN',
      misconception_code: 'COMPLEMENT_CONFUSION',
    },
  ],
  fact_establishments: [
    { fact: 'READ_FRACTION', revealed_at_chunk_index: 0 },
    { fact: 'WHOLE', revealed_at_chunk_index: 1 },
  ],
  sufficiency_dependencies: [
    {
      action_type: 'SUBMIT_FINAL_ANSWER',
      requires_facts: ['WHOLE'],
      misconception_code: 'PREMATURE_QUANTIFICATION',
      requires_acknowledgment: true,
      message:
        'The whole is not known yet. Acknowledge that information is insufficient before continuing.',
    },
  ],
  chunk_count: 3,
  gates: [
    { reveals_chunk_index: 1, requires_commitment: 'READ_FRACTION_IDENTIFIED' },
    { reveals_chunk_index: 2, requires_commitment: 'WHOLE_IDENTIFIED' },
  ],
  completion_rule: { requires_slots_filled: ['FRACTION', 'WHOLE', 'UNKNOWN'] },
  expected_final_result: { value: '20', unit: 'pages' },
};

function freshState(definition: EngineProblemDefinition = def): EngineSessionState {
  return {
    status: 'ACTIVE',
    current_chunk_index: 0,
    workspace: {
      slots: definition.workspace_slots.map((slot) => ({
        slot,
        token_id: null,
        label: null,
      })),
      pending_acknowledgment: null,
    },
    accepted_commitments: [],
  };
}

function assign(
  definition: EngineProblemDefinition,
  state: EngineSessionState,
  slot: EngineProblemDefinition['assignable'][number]['slot'],
  token_id: string,
): EngineSessionState {
  const result = applyAction({
    problemDefinition: definition,
    sessionState: state,
    action: { action_type: 'ASSIGN_SLOT', payload: { slot, token_id } },
  });
  expect(result.outcome).toBe('ACCEPTED');
  return result.nextState;
}

function commit(
  definition: EngineProblemDefinition,
  state: EngineSessionState,
): EngineSessionState {
  const result = applyAction({
    problemDefinition: definition,
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

  it('classifies invalid token/slot pairing deterministically (AC-030)', () => {
    const state = freshState();
    const first = applyAction({
      problemDefinition: def,
      sessionState: state,
      action: {
        action_type: 'ASSIGN_SLOT',
        payload: { slot: 'WHOLE', token_id: 'ex01-c1-percent' },
      },
    });
    const second = applyAction({
      problemDefinition: def,
      sessionState: state,
      action: {
        action_type: 'ASSIGN_SLOT',
        payload: { slot: 'WHOLE', token_id: 'ex01-c1-percent' },
      },
    });
    expect(first.outcome).toBe('REJECTED');
    expect(first.misconception_code).toBe('WHOLE_PART_CONFUSION');
    expect(first).toEqual(second);
    expect(first.nextState.workspace.slots.find((s) => s.slot === 'WHOLE')?.token_id).toBeNull();
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
    const withWhole = assign(def, freshState(), 'WHOLE', 'ex01-c0-whole');
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
    state = assign(def, state, 'WHOLE', 'ex01-c0-whole');
    state = commit(def, state);
    state = assign(def, state, 'PART_IN_PERCENTAGE', 'ex01-c1-percent');
    state = commit(def, state);
    state = assign(def, state, 'UNKNOWN', 'ex01-c2-unknown');
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

    let mid = assign(def, freshState(), 'WHOLE', 'ex01-c0-whole');
    mid = commit(def, mid);
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
    state = assign(def, state, 'WHOLE', 'ex01-c0-whole');
    state = commit(def, state);
    state = assign(def, state, 'PART_IN_PERCENTAGE', 'ex01-c1-percent');
    state = commit(def, state);
    state = assign(def, state, 'UNKNOWN', 'ex01-c2-unknown');

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
    state = assign(def, state, 'WHOLE', 'ex01-c0-whole');
    state = commit(def, state);
    state = assign(def, state, 'PART_IN_PERCENTAGE', 'ex01-c1-percent');
    state = commit(def, state);
    state = assign(def, state, 'UNKNOWN', 'ex01-c2-unknown');

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
    state = assign(def, state, 'WHOLE', 'ex01-c0-whole');
    state = commit(def, state);
    state = assign(def, state, 'PART_IN_PERCENTAGE', 'ex01-c1-percent');
    state = commit(def, state);
    state = assign(def, state, 'UNKNOWN', 'ex01-c2-unknown');

    const result = applyAction({
      problemDefinition: def,
      sessionState: state,
      action: { action_type: 'SUBMIT_FINAL_ANSWER', payload: { value: ' 12.0 ' } },
    });
    expect(result.outcome).toBe('ACCEPTED');
    expect(result.nextState.status).toBe('COMPLETED');
  });

  it('rejects acknowledgment when none is pending', () => {
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
    const state = assign(def, freshState(), 'WHOLE', 'ex01-c0-whole');
    const allowed = computeAllowedActions(def, state);
    expect(allowed).toContain('SUBMIT_COMMITMENT');
    expect(allowed).toContain('DELETE_ASSIGNMENT');
    expect(allowed).not.toContain('ASSIGN_SLOT');
    expect(allowed).not.toContain('SUBMIT_FINAL_ANSWER');
    expect(computeRequiredNextAction(def, state)).toEqual({ action_type: 'SUBMIT_COMMITMENT' });
  });

  it('at last chunk with slots filled, final answer is required', () => {
    let state = freshState();
    state = assign(def, state, 'WHOLE', 'ex01-c0-whole');
    state = commit(def, state);
    state = assign(def, state, 'PART_IN_PERCENTAGE', 'ex01-c1-percent');
    state = commit(def, state);
    state = assign(def, state, 'UNKNOWN', 'ex01-c2-unknown');

    const allowed = computeAllowedActions(def, state);
    expect(allowed).toContain('SUBMIT_FINAL_ANSWER');
    expect(allowed).not.toContain('SUBMIT_COMMITMENT');
    expect(computeRequiredNextAction(def, state)).toEqual({ action_type: 'SUBMIT_FINAL_ANSWER' });
  });

  it('returns no actions once completed', () => {
    let state = freshState();
    state = assign(def, state, 'WHOLE', 'ex01-c0-whole');
    state = commit(def, state);
    state = assign(def, state, 'PART_IN_PERCENTAGE', 'ex01-c1-percent');
    state = commit(def, state);
    state = assign(def, state, 'UNKNOWN', 'ex01-c2-unknown');
    const done = applyAction({
      problemDefinition: def,
      sessionState: state,
      action: { action_type: 'SUBMIT_FINAL_ANSWER', payload: { value: '12' } },
    }).nextState;
    expect(computeAllowedActions(def, done)).toEqual([]);
    expect(computeRequiredNextAction(def, done)).toEqual({ action_type: null });
  });

  it('is deterministic for identical inputs', () => {
    const state = assign(def, freshState(), 'WHOLE', 'ex01-c0-whole');
    expect(computeAllowedActions(def, state)).toEqual(computeAllowedActions(def, state));
    expect(computeRequiredNextAction(def, state)).toEqual(computeRequiredNextAction(def, state));
  });
});

describe('Slice 03 premature quantification + acknowledgment (EX-02)', () => {
  it('blocks numeric answer before scale as PREMATURE_QUANTIFICATION without advancing (AC-028)', () => {
    const state = freshState(ratioDef);
    const result = applyAction({
      problemDefinition: ratioDef,
      sessionState: state,
      action: { action_type: 'SUBMIT_FINAL_ANSWER', payload: { value: '10' } },
    });
    expect(result.outcome).toBe('REJECTED');
    expect(result.misconception_code).toBe('PREMATURE_QUANTIFICATION');
    expect(result.nextState.current_chunk_index).toBe(0);
    expect(result.nextState.workspace.pending_acknowledgment?.misconception_code).toBe(
      'PREMATURE_QUANTIFICATION',
    );
    expect(result.events[0]?.event_type).toBe('PREMATURE_COMMITMENT_BLOCKED');
  });

  it('same state/action always yields the same classification (AC-030)', () => {
    const state = freshState(ratioDef);
    const action = {
      action_type: 'SUBMIT_FINAL_ANSWER' as const,
      payload: { value: '10' },
    };
    const a = applyAction({ problemDefinition: ratioDef, sessionState: state, action });
    const b = applyAction({ problemDefinition: ratioDef, sessionState: state, action });
    expect(a.misconception_code).toBe(b.misconception_code);
    expect(a).toEqual(b);
  });

  it('acknowledgment requirement cannot be bypassed (AC-029)', () => {
    const blocked = applyAction({
      problemDefinition: ratioDef,
      sessionState: freshState(ratioDef),
      action: { action_type: 'SUBMIT_FINAL_ANSWER', payload: { value: '10' } },
    }).nextState;

    const assignBypass = applyAction({
      problemDefinition: ratioDef,
      sessionState: blocked,
      action: {
        action_type: 'ASSIGN_SLOT',
        payload: { slot: 'RATIO', token_id: 'ex02-c0-ratio' },
      },
    });
    expect(assignBypass.outcome).toBe('REJECTED');
    expect(assignBypass.nextState.workspace.pending_acknowledgment).not.toBeNull();

    expect(computeAllowedActions(ratioDef, blocked)).toEqual([
      'ACKNOWLEDGE_INSUFFICIENT_INFORMATION',
    ]);
    expect(computeRequiredNextAction(ratioDef, blocked)).toEqual({
      action_type: 'ACKNOWLEDGE_INSUFFICIENT_INFORMATION',
    });
  });

  it('acknowledgment clears the gate and EX-02 completes with 10 (AC-037)', () => {
    let state = applyAction({
      problemDefinition: ratioDef,
      sessionState: freshState(ratioDef),
      action: { action_type: 'SUBMIT_FINAL_ANSWER', payload: { value: '10' } },
    }).nextState;

    const ack = applyAction({
      problemDefinition: ratioDef,
      sessionState: state,
      action: { action_type: 'ACKNOWLEDGE_INSUFFICIENT_INFORMATION', payload: {} },
    });
    expect(ack.outcome).toBe('ACCEPTED');
    expect(ack.nextState.workspace.pending_acknowledgment).toBeNull();
    expect(ack.events[0]?.event_type).toBe('INSUFFICIENT_INFORMATION_ACKNOWLEDGED');
    state = ack.nextState;

    state = assign(ratioDef, state, 'RATIO', 'ex02-c0-ratio');
    state = commit(ratioDef, state);
    state = assign(ratioDef, state, 'PART_IN_NUMBER', 'ex02-c1-blue');
    state = commit(ratioDef, state);
    state = assign(ratioDef, state, 'UNKNOWN', 'ex02-c2-unknown');

    const done = applyAction({
      problemDefinition: ratioDef,
      sessionState: state,
      action: { action_type: 'SUBMIT_FINAL_ANSWER', payload: { value: '10' } },
    });
    expect(done.outcome).toBe('ACCEPTED');
    expect(done.nextState.status).toBe('COMPLETED');
  });
});

describe('Slice 03 complement confusion + EX-03 (AC-038)', () => {
  it('blocks page calculation before Whole as premature (AC-028)', () => {
    const result = applyAction({
      problemDefinition: fractionDef,
      sessionState: freshState(fractionDef),
      action: { action_type: 'SUBMIT_FINAL_ANSWER', payload: { value: '20' } },
    });
    expect(result.outcome).toBe('REJECTED');
    expect(result.misconception_code).toBe('PREMATURE_QUANTIFICATION');
    expect(result.nextState.current_chunk_index).toBe(0);
  });

  it('rejects treating 3/5 as remaining fraction as COMPLEMENT_CONFUSION', () => {
    let state = freshState(fractionDef);
    state = assign(fractionDef, state, 'FRACTION', 'ex03-c0-fraction');
    state = commit(fractionDef, state);
    state = assign(fractionDef, state, 'WHOLE', 'ex03-c1-whole');
    state = commit(fractionDef, state);

    const bad = applyAction({
      problemDefinition: fractionDef,
      sessionState: state,
      action: {
        action_type: 'ASSIGN_SLOT',
        payload: { slot: 'UNKNOWN', token_id: 'ex03-c0-fraction' },
      },
    });
    expect(bad.outcome).toBe('REJECTED');
    expect(bad.misconception_code).toBe('COMPLEMENT_CONFUSION');
    expect(bad.nextState.workspace.slots.find((s) => s.slot === 'UNKNOWN')?.token_id).toBeNull();
    expect(bad.nextState.current_chunk_index).toBe(2);
  });

  it('EX-03 completes with 20 after correct unread Unknown', () => {
    let state = freshState(fractionDef);
    const premature = applyAction({
      problemDefinition: fractionDef,
      sessionState: state,
      action: { action_type: 'SUBMIT_FINAL_ANSWER', payload: { value: '30' } },
    });
    state = premature.nextState;
    state = applyAction({
      problemDefinition: fractionDef,
      sessionState: state,
      action: { action_type: 'ACKNOWLEDGE_INSUFFICIENT_INFORMATION', payload: {} },
    }).nextState;

    state = assign(fractionDef, state, 'FRACTION', 'ex03-c0-fraction');
    state = commit(fractionDef, state);
    state = assign(fractionDef, state, 'WHOLE', 'ex03-c1-whole');
    state = commit(fractionDef, state);
    state = assign(fractionDef, state, 'UNKNOWN', 'ex03-c2-unknown');

    const done = applyAction({
      problemDefinition: fractionDef,
      sessionState: state,
      action: { action_type: 'SUBMIT_FINAL_ANSWER', payload: { value: '20' } },
    });
    expect(done.outcome).toBe('ACCEPTED');
    expect(done.nextState.status).toBe('COMPLETED');
  });
});
