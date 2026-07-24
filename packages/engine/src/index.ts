import type { ActionType } from '@app/contracts';
import type {
  EngineAction,
  EngineGate,
  EngineProblemDefinition,
  EngineResult,
  EngineRollbackRecord,
  EngineRollbackRule,
  EngineSessionState,
  EngineSufficiencyDependency,
  PendingAcknowledgment,
  WorkspaceState,
} from './types.js';

export * from './types.js';

/** Safe client messages for fixture guidance codes (never hidden content). */
const GUIDANCE_MESSAGES: Record<string, string> = {
  GUIDE_DELETE_CONFLICT:
    'Repeated conflicting assignment. Delete conflicts and rebuild from the earlier stage.',
};

/**
 * Pure reasoning engine (ARCHITECTURE §8).
 *
 * Slice 02: typed workspace + progressive reveal + final answer.
 * Slice 03: data-driven semantic sufficiency, premature quantification,
 * ACKNOWLEDGE_INSUFFICIENT_INFORMATION, and invalid-assignment misconceptions.
 * Slice 04: occupied-slot conflict classification, misconception repetition,
 * and deterministic fixture-defined rollback.
 *
 * Deterministic; no I/O.
 */
export function applyAction(input: {
  problemDefinition: EngineProblemDefinition;
  sessionState: EngineSessionState;
  action: EngineAction;
  /**
   * Counts of prior completed REJECTED attempts for this session, keyed by
   * misconception_code. The current attempt is not included; the engine adds 1.
   */
  priorMisconceptionCounts?: Record<string, number>;
}): EngineResult {
  const { problemDefinition, sessionState, action } = input;
  const priorCounts = input.priorMisconceptionCounts ?? {};

  if (sessionState.status !== 'ACTIVE') {
    return rejectFrom(sessionState, action, 'This session is no longer active.');
  }

  // Acknowledgment gate: only ack (and delete) may proceed while pending (PB-010).
  if (
    sessionState.workspace.pending_acknowledgment &&
    action.action_type !== 'ACKNOWLEDGE_INSUFFICIENT_INFORMATION' &&
    action.action_type !== 'DELETE_ASSIGNMENT'
  ) {
    const pending = sessionState.workspace.pending_acknowledgment;
    return finalizeReject(
      rejectFrom(sessionState, action, pending.message, pending.misconception_code),
      problemDefinition,
      priorCounts,
    );
  }

  let result: EngineResult;
  switch (action.action_type) {
    case 'ASSIGN_SLOT':
      result = assignSlot(problemDefinition, sessionState, action);
      break;
    case 'DELETE_ASSIGNMENT':
      result = deleteAssignment(sessionState, action);
      break;
    case 'SUBMIT_COMMITMENT':
      result = submitCommitment(problemDefinition, sessionState, action);
      break;
    case 'SUBMIT_FINAL_ANSWER':
      result = submitFinalAnswer(problemDefinition, sessionState, action);
      break;
    case 'ACKNOWLEDGE_INSUFFICIENT_INFORMATION':
      result = acknowledgeInsufficient(sessionState, action);
      break;
    default:
      result = rejectFrom(sessionState, action, 'Unsupported action.');
  }

  if (result.outcome === 'REJECTED') {
    return finalizeReject(result, problemDefinition, priorCounts);
  }
  return withNoRollback(result);
}

/** Actions the client may offer for the current durable state (server truth). */
export function computeAllowedActions(
  def: EngineProblemDefinition,
  state: EngineSessionState,
): ActionType[] {
  if (state.status !== 'ACTIVE') return [];

  if (state.workspace.pending_acknowledgment) {
    const allowed: ActionType[] = ['ACKNOWLEDGE_INSUFFICIENT_INFORMATION'];
    if (state.workspace.slots.some((s) => s.token_id !== null)) {
      allowed.push('DELETE_ASSIGNMENT');
    }
    return allowed;
  }

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
 * Single preferred next step for UI guidance. Priority: acknowledge → fill
 * structure → commit → final answer.
 */
export function computeRequiredNextAction(
  def: EngineProblemDefinition,
  state: EngineSessionState,
): { action_type: ActionType | null } {
  if (state.status !== 'ACTIVE') {
    return { action_type: null };
  }
  if (state.workspace.pending_acknowledgment) {
    return { action_type: 'ACKNOWLEDGE_INSUFFICIENT_INFORMATION' };
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
  return {
    slots: workspace.slots.map((s) => ({ ...s })),
    pending_acknowledgment: workspace.pending_acknowledgment
      ? { ...workspace.pending_acknowledgment }
      : null,
  };
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

  const invalid = def.invalid_assignments.find((a) => a.token_id === token_id && a.slot === slot);
  if (invalid) {
    return rejectFrom(
      state,
      action,
      'That assignment is structurally invalid.',
      invalid.misconception_code,
    );
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
    return rejectFrom(
      state,
      action,
      'That slot is already occupied. Delete it first.',
      'CONFLICTING_SLOT_ASSIGNMENT',
    );
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
    guidance_code: null,
    rollback: null,
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
    guidance_code: null,
    rollback: null,
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
    guidance_code: null,
    rollback: null,
  };
}

function submitFinalAnswer(
  def: EngineProblemDefinition,
  state: EngineSessionState,
  action: EngineAction,
): EngineResult {
  const premature = findUnmetSufficiency(def, state, 'SUBMIT_FINAL_ANSWER');
  if (premature) {
    return rejectPremature(state, action, premature);
  }

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
      guidance_code: null,
      rollback: null,
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
    guidance_code: null,
    rollback: null,
  };
}

function acknowledgeInsufficient(state: EngineSessionState, action: EngineAction): EngineResult {
  const pending = state.workspace.pending_acknowledgment;
  if (!pending) {
    return rejectFrom(state, action, 'No insufficient-information acknowledgment is required.');
  }

  const workspace = cloneWorkspace(state.workspace);
  workspace.pending_acknowledgment = null;
  const nextState: EngineSessionState = { ...state, workspace };
  return {
    outcome: 'ACCEPTED',
    nextState,
    events: [
      {
        event_type: 'INSUFFICIENT_INFORMATION_ACKNOWLEDGED',
        chunk_index: state.current_chunk_index,
        misconception_code: pending.misconception_code,
        payload: {
          action_type: action.action_type,
          misconception_code: pending.misconception_code,
        },
      },
    ],
    misconception_code: null,
    message: null,
    guidance_code: null,
    rollback: null,
  };
}

function findUnmetSufficiency(
  def: EngineProblemDefinition,
  state: EngineSessionState,
  actionType: 'SUBMIT_FINAL_ANSWER',
): EngineSufficiencyDependency | null {
  const established = establishedFacts(def, state);
  for (const dep of def.sufficiency_dependencies) {
    if (dep.action_type !== actionType) continue;
    const missing = dep.requires_facts.some((f) => !established.has(f));
    if (missing) return dep;
  }
  return null;
}

function establishedFacts(def: EngineProblemDefinition, state: EngineSessionState): Set<string> {
  const facts = new Set<string>();
  for (const est of def.fact_establishments) {
    if (est.revealed_at_chunk_index <= state.current_chunk_index) {
      facts.add(est.fact);
    }
  }
  return facts;
}

/**
 * Premature action: classify misconception, optionally set durable acknowledgment
 * requirement, never advance reveal (PB-009/010, AC-028/029).
 */
function rejectPremature(
  state: EngineSessionState,
  action: EngineAction,
  dep: EngineSufficiencyDependency,
): EngineResult {
  let nextState = state;
  if (dep.requires_acknowledgment) {
    const pending: PendingAcknowledgment = {
      misconception_code: dep.misconception_code,
      message: dep.message,
    };
    // Idempotent: re-attempting while already pending keeps the same guidance.
    if (
      !state.workspace.pending_acknowledgment ||
      state.workspace.pending_acknowledgment.misconception_code !== pending.misconception_code
    ) {
      const workspace = cloneWorkspace(state.workspace);
      workspace.pending_acknowledgment = pending;
      nextState = { ...state, workspace };
    }
  }

  return {
    outcome: 'REJECTED',
    nextState,
    events: [
      {
        event_type: 'PREMATURE_COMMITMENT_BLOCKED',
        chunk_index: state.current_chunk_index,
        misconception_code: dep.misconception_code,
        payload: {
          action_type: action.action_type,
          misconception_code: dep.misconception_code,
          requires_acknowledgment: dep.requires_acknowledgment,
        },
      },
    ],
    misconception_code: dep.misconception_code,
    message: dep.message,
    guidance_code: null,
    rollback: null,
  };
}

/**
 * When a classified reject matches a fixture rollback rule at the current
 * repeat count, roll the durable state back and attach a rollback record
 * (PB-011–014, AC-031/039).
 */
function finalizeReject(
  result: EngineResult,
  def: EngineProblemDefinition,
  priorCounts: Record<string, number>,
): EngineResult {
  if (!result.misconception_code) {
    return withNoRollback(result);
  }

  const repeatCount = (priorCounts[result.misconception_code] ?? 0) + 1;
  const rule = selectRollbackRule(def.rollback_rules, result.misconception_code, repeatCount);
  if (!rule) {
    return withNoRollback(result);
  }

  const fromChunk = result.nextState.current_chunk_index;
  const toChunk = Math.max(0, fromChunk - rule.rollback_depth);
  const nextState = applyRollbackTransition(def, result.nextState, toChunk);
  const guidanceMessage =
    GUIDANCE_MESSAGES[rule.guidance_code] ??
    `Rollback guidance: ${rule.guidance_code}. Rebuild from the earlier stage.`;

  const rollback: EngineRollbackRecord = {
    misconception_code: result.misconception_code,
    from_chunk_index: fromChunk,
    to_chunk_index: toChunk,
    rollback_depth: rule.rollback_depth,
    repeat_count: repeatCount,
    guidance_code: rule.guidance_code,
  };

  return {
    outcome: 'REJECTED',
    nextState,
    events: [
      ...result.events,
      {
        event_type: 'ROLLBACK_APPLIED',
        chunk_index: toChunk,
        misconception_code: result.misconception_code,
        payload: {
          misconception_code: result.misconception_code,
          from_chunk_index: fromChunk,
          to_chunk_index: toChunk,
          rollback_depth: rule.rollback_depth,
          repeat_count: repeatCount,
          guidance_code: rule.guidance_code,
        },
      },
    ],
    misconception_code: result.misconception_code,
    message: guidanceMessage,
    guidance_code: rule.guidance_code,
    rollback,
  };
}

/** Highest matching `repeat_from` at or below the current repeat count. */
export function selectRollbackRule(
  rules: EngineRollbackRule[],
  misconceptionCode: string,
  repeatCount: number,
): EngineRollbackRule | null {
  let best: EngineRollbackRule | null = null;
  for (const rule of rules) {
    if (rule.misconception_code !== misconceptionCode) continue;
    if (rule.repeat_from > repeatCount) continue;
    if (!best || rule.repeat_from > best.repeat_from) {
      best = rule;
    }
  }
  return best;
}

/**
 * Deterministic rollback transition: retreat reveal, drop later commitments,
 * clear slots that required later chunks, clear pending acknowledgment.
 */
export function applyRollbackTransition(
  def: EngineProblemDefinition,
  state: EngineSessionState,
  toChunkIndex: number,
): EngineSessionState {
  const keptCommitments = state.accepted_commitments.filter((commitment) => {
    const gate = def.gates.find((g) => g.requires_commitment === commitment);
    if (!gate) return false;
    return gate.reveals_chunk_index <= toChunkIndex;
  });

  const workspace = cloneWorkspace(state.workspace);
  workspace.pending_acknowledgment = null;
  for (const slot of workspace.slots) {
    const assignable = def.assignable.find(
      (a) => a.slot === slot.slot && a.token_id === slot.token_id,
    );
    if (
      slot.token_id !== null &&
      assignable &&
      assignable.requires_revealed_chunk_index > toChunkIndex
    ) {
      slot.token_id = null;
      slot.label = null;
    }
  }

  return {
    ...state,
    current_chunk_index: toChunkIndex,
    accepted_commitments: keptCommitments,
    workspace,
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
  if (findUnmetSufficiency(def, state, 'SUBMIT_FINAL_ANSWER')) return false;
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

function withNoRollback(result: EngineResult): EngineResult {
  return {
    ...result,
    guidance_code: result.guidance_code ?? null,
    rollback: null,
  };
}

function rejectFrom(
  state: EngineSessionState,
  action: EngineAction,
  message: string,
  misconception: string | null = null,
): EngineResult {
  return {
    outcome: 'REJECTED',
    nextState: state,
    events: [
      {
        event_type: 'ACTION_REJECTED',
        chunk_index: state.current_chunk_index,
        misconception_code: misconception,
        payload: {
          action_type: action.action_type,
          ...(misconception ? { misconception_code: misconception } : {}),
        },
      },
    ],
    misconception_code: misconception,
    message,
    guidance_code: null,
    rollback: null,
  };
}
