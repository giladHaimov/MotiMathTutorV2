import type {
  EngineAction,
  EngineProblemDefinition,
  EngineResult,
  EngineSessionState,
  WorkspaceState,
} from './types.js';

export * from './types.js';

/**
 * Slice 01 reasoning engine — intentionally minimal and pure.
 *
 * Supported now:
 *  - ASSIGN_SLOT: place a permitted token into an empty typed slot.
 *  - DELETE_ASSIGNMENT: clear an occupied slot.
 *
 * Everything else (commitment gating, chunk reveal advancement, misconception
 * classification, rollback) is explicitly out of scope for Slice 01 and is
 * rejected safely without changing state. The function is deterministic and
 * performs no I/O (ARCHITECTURE §8).
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
    // Reveal gating, sufficiency, acknowledgment, and final answer arrive in later slices.
    case 'SUBMIT_COMMITMENT':
    case 'ACKNOWLEDGE_INSUFFICIENT_INFORMATION':
    case 'SUBMIT_FINAL_ANSWER':
      return reject('This action is not available yet in this session.');
    default:
      return reject('Unsupported action.');
  }
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
    // No misconception classification in Slice 01 — just a safe, non-mutating rejection.
    return rejectFrom(state, action, 'That value cannot be placed in that slot.');
  }
  if (permitted.requires_revealed_chunk_index > state.current_chunk_index) {
    return rejectFrom(state, action, 'The required information has not been revealed yet.');
  }

  const target = state.workspace.slots.find((s) => s.slot === slot);
  if (target && target.token_id !== null) {
    // Occupied-slot conflict resolution (explicit deletion) is Slice 04; block here.
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
