import type { ActionType } from '@app/contracts';
import type {
  EngineAction,
  EngineGate,
  EngineProblemDefinition,
  EngineResult,
  EngineSessionState,
  WorkspaceState,
} from './types.js';

export * from './types.js';

/**
 * Pure reasoning engine (ARCHITECTURE §8).
 *
 * Slice 02 supports:
 *  - ASSIGN_SLOT / DELETE_ASSIGNMENT (typed workspace)
 *  - SUBMIT_COMMITMENT (position-derived gate → progressive reveal)
 *  - SUBMIT_FINAL_ANSWER (completion_rule + expected_final_result)
 *
 * ACKNOWLEDGE_INSUFFICIENT_INFORMATION remains Slice 03. Misconception /
 * rollback depth remains Slice 04. The function is deterministic and performs
 * no I/O.
 */
export function applyAction(input: {
  problemDefinition: EngineProblemDefinition;
  sessionState: EngineSessionState;
  action: EngineAction;
}): EngineResult {
  const { problemDefinition, sessionState, action } = input;

  const reject = (message: string, misconception: string | null = null): EngineResult => ({
    outcome: 'REJECTED',
    nextState: sessionState,
    events: [
      {
        event_type: 'ACTION_REJECTED',
        chunk_index: sessionState.current_chunk_index,
        misconception_code: misconception,
        payload: { action_type: action.action_type },
      },
    ],
    misconception_code: misconception,
    message,
  });

  if (sessionState.status !== 'ACTIVE') {
    return reject('This session is no longer active.');
  }

  switch (action.action_type) {
    case 'ASSIGN_SLOT':
      return assignSlot(problemDefinition, sessionState, action);
    case 'DELETE_ASSIGNMENT':
      return deleteAssignment(sessionState, action);
    case 'SUBMIT_COMMITMENT':
      return submitCommitment(problemDefinition, sessionState, action);
    case 'SUBMIT_FINAL_ANSWER':
      return submitFinalAnswer(problemDefinition, sessionState, action);
    case 'ACKNOWLEDGE_INSUFFICIENT_INFORMATION':
      return reject('This action is not available yet in this session.');
    default:
      return reject('Unsupported action.');
  }
}

/** Actions the client may offer for the current durable state (server truth). */
export function computeAllowedActions(
  def: EngineProblemDefinition,
  state: EngineSessionState,
): ActionType[] {
  if (state.status !== 'ACTIVE') return [];

  const allowed: ActionType[] = [];
  if (hasReachableEmptyAssignable(def, state)) {
    allowed.push('ASSIGN_SLOT');
  }
  if (state.workspace.slots.some((s) => s.token_id !== null)) {
    allowed.push('DELETE_ASSIGNMENT');
  }
  if (commitmentReady(def, state)) {
    allowed.push('SUBMIT_COMMITMENT');
  }
  if (finalAnswerReady(def, state)) {
    allowed.push('SUBMIT_FINAL_ANSWER');
  }
  return allowed;
}

/**
 * Single preferred next step for UI guidance. Priority: fill structure → commit
 * → fill remaining → final answer.
 */
export function computeRequiredNextAction(
  def: EngineProblemDefinition,
  state: EngineSessionState,
): { action_type: ActionType | null } {
  if (state.status !== 'ACTIVE') {
    return { action_type: null };
  }
  if (hasReachableEmptyAssignable(def, state)) {
    return { action_type: 'ASSIGN_SLOT' };
  }
  if (commitmentReady(def, state)) {
    return { action_type: 'SUBMIT_COMMITMENT' };
  }
  if (finalAnswerReady(def, state)) {
    return { action_type: 'SUBMIT_FINAL_ANSWER' };
  }
  return { action_type: null };
}

function cloneWorkspace(workspace: WorkspaceState): WorkspaceState {
  return { slots: workspace.slots.map((s) => ({ ...s })) };
}

function assignSlot(
  def: EngineProblemDefinition,
  state: EngineSessionState,
  action: EngineAction,
): EngineResult {
  const { slot, token_id } = action.payload;
  if (!slot || !token_id) {
    return rejectFrom(state, action, 'Assignment requires a slot and a token.');
  }
  if (!def.workspace_slots.includes(slot)) {
    return rejectFrom(state, action, 'That slot does not exist for this problem.');
  }

  const permitted = def.assignable.find((a) => a.token_id === token_id && a.slot === slot);
  if (!permitted) {
    return rejectFrom(state, action, 'That value cannot be placed in that slot.');
  }
  if (permitted.requires_revealed_chunk_index > state.current_chunk_index) {
    return rejectFrom(state, action, 'The required information has not been revealed yet.');
  }

  const target = state.workspace.slots.find((s) => s.slot === slot);
  if (target && target.token_id !== null) {
    // Occupied-slot conflict: explicit deletion required (PB-007 / AC-026).
    return rejectFrom(state, action, 'That slot is already occupied. Delete it first.');
  }

  const workspace = cloneWorkspace(state.workspace);
  const dest = workspace.slots.find((s) => s.slot === slot);
  if (dest) {
    dest.token_id = token_id;
    dest.label = permitted.label;
  } else {
    workspace.slots.push({ slot, token_id, label: permitted.label });
  }

  const nextState: EngineSessionState = { ...state, workspace };
  return {
    outcome: 'ACCEPTED',
    nextState,
    events: [
      {
        event_type: 'SLOT_ASSIGNED',
        chunk_index: state.current_chunk_index,
        misconception_code: null,
        payload: { slot, token_id },
      },
    ],
    misconception_code: null,
    message: null,
  };
}

function deleteAssignment(state: EngineSessionState, action: EngineAction): EngineResult {
  const { slot } = action.payload;
  if (!slot) {
    return rejectFrom(state, action, 'Deletion requires a slot.');
  }
  const target = state.workspace.slots.find((s) => s.slot === slot);
  if (!target || target.token_id === null) {
    return rejectFrom(state, action, 'There is nothing to delete in that slot.');
  }

  const workspace = cloneWorkspace(state.workspace);
  const dest = workspace.slots.find((s) => s.slot === slot);
  if (dest) {
    dest.token_id = null;
    dest.label = null;
  }
  const nextState: EngineSessionState = { ...state, workspace };
  return {
    outcome: 'ACCEPTED',
    nextState,
    events: [
      {
        event_type: 'ASSIGNMENT_DELETED',
        chunk_index: state.current_chunk_index,
        misconception_code: null,
        payload: { slot },
      },
    ],
    misconception_code: null,
    message: null,
  };
}

function submitCommitment(
  def: EngineProblemDefinition,
  state: EngineSessionState,
  action: EngineAction,
): EngineResult {
  const gate = nextGate(def, state);
  if (!gate) {
    return rejectFrom(state, action, 'No further commitment is required at this stage.');
  }
  if (!gateRequirementMet(def, state)) {
    return rejectFrom(
      state,
      action,
      'Required structural assignments are incomplete. Progression remains blocked.',
    );
  }
  if (state.accepted_commitments.includes(gate.requires_commitment)) {
    return rejectFrom(state, action, 'That commitment has already been accepted.');
  }

  const nextState: EngineSessionState = {
    ...state,
    current_chunk_index: gate.reveals_chunk_index,
    accepted_commitments: [...state.accepted_commitments, gate.requires_commitment],
  };
  return {
    outcome: 'ACCEPTED',
    nextState,
    events: [
      {
        event_type: 'COMMITMENT_ACCEPTED',
        chunk_index: gate.reveals_chunk_index,
        misconception_code: null,
        payload: {
          commitment: gate.requires_commitment,
          reveals_chunk_index: gate.reveals_chunk_index,
        },
      },
    ],
    misconception_code: null,
    message: null,
  };
}

function submitFinalAnswer(
  def: EngineProblemDefinition,
  state: EngineSessionState,
  action: EngineAction,
): EngineResult {
  if (!finalAnswerReady(def, state)) {
    return rejectFrom(
      state,
      action,
      'The final answer is not available until all required structural gates are complete.',
    );
  }

  const submitted = action.payload.value;
  if (submitted === undefined || submitted.trim() === '') {
    return rejectFrom(state, action, 'A final answer value is required.');
  }

  if (!answersMatch(submitted, def.expected_final_result.value)) {
    return {
      outcome: 'REJECTED',
      nextState: state,
      events: [
        {
          event_type: 'FINAL_ANSWER_REJECTED',
          chunk_index: state.current_chunk_index,
          misconception_code: null,
          payload: { action_type: action.action_type },
        },
      ],
      misconception_code: null,
      message: 'That answer is not correct. The session is not complete.',
    };
  }

  const nextState: EngineSessionState = { ...state, status: 'COMPLETED' };
  return {
    outcome: 'ACCEPTED',
    nextState,
    events: [
      {
        event_type: 'SESSION_COMPLETED',
        chunk_index: state.current_chunk_index,
        misconception_code: null,
        payload: {
          value: def.expected_final_result.value,
          unit: def.expected_final_result.unit,
        },
      },
    ],
    misconception_code: null,
    message: null,
  };
}

function nextGate(def: EngineProblemDefinition, state: EngineSessionState): EngineGate | undefined {
  return def.gates.find((g) => g.reveals_chunk_index === state.current_chunk_index + 1);
}

/**
 * Position-derived gate check: every assignable whose reveal requirement is at
 * or before the current chunk must already occupy its target slot with the
 * correct token. No extra fixture fields are required.
 */
function gateRequirementMet(def: EngineProblemDefinition, state: EngineSessionState): boolean {
  const required = def.assignable.filter(
    (a) => a.requires_revealed_chunk_index <= state.current_chunk_index,
  );
  if (required.length === 0) return false;
  return required.every((a) => {
    const filled = state.workspace.slots.find((s) => s.slot === a.slot);
    return filled?.token_id === a.token_id;
  });
}

function commitmentReady(def: EngineProblemDefinition, state: EngineSessionState): boolean {
  const gate = nextGate(def, state);
  if (!gate) return false;
  if (state.accepted_commitments.includes(gate.requires_commitment)) return false;
  return gateRequirementMet(def, state);
}

function finalAnswerReady(def: EngineProblemDefinition, state: EngineSessionState): boolean {
  if (state.current_chunk_index !== def.chunk_count - 1) return false;
  if (nextGate(def, state)) return false;
  return def.completion_rule.requires_slots_filled.every((slot) => {
    const filled = state.workspace.slots.find((s) => s.slot === slot);
    return filled?.token_id !== null && filled?.token_id !== undefined;
  });
}

function hasReachableEmptyAssignable(
  def: EngineProblemDefinition,
  state: EngineSessionState,
): boolean {
  return def.assignable.some((a) => {
    if (a.requires_revealed_chunk_index > state.current_chunk_index) return false;
    const filled = state.workspace.slots.find((s) => s.slot === a.slot);
    return !filled || filled.token_id === null;
  });
}

/** Trim + numeric-normalized equality against the fixture expected value. */
export function answersMatch(submitted: string, expected: string): boolean {
  return normalizeAnswer(submitted) === normalizeAnswer(expected);
}

function normalizeAnswer(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') return trimmed;
  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber)) {
    return String(asNumber);
  }
  return trimmed;
}

function rejectFrom(
  state: EngineSessionState,
  action: EngineAction,
  message: string,
): EngineResult {
  return {
    outcome: 'REJECTED',
    nextState: state,
    events: [
      {
        event_type: 'ACTION_REJECTED',
        chunk_index: state.current_chunk_index,
        misconception_code: null,
        payload: { action_type: action.action_type },
      },
    ],
    misconception_code: null,
    message,
  };
}
