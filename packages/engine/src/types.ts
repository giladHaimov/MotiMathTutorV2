import type { ActionType, Slot } from '@app/contracts';

/**
 * Structural inputs/outputs for the pure reasoning engine.
 *
 * The engine performs NO I/O (ARCHITECTURE §8). The session service loads the
 * pinned problem definition and durable state, calls {@link applyAction}, and
 * owns the transaction that persists the result.
 */

/** Reveal gate: accepting `requires_commitment` advances disclosure to `reveals_chunk_index`. */
export interface EngineGate {
  reveals_chunk_index: number;
  requires_commitment: string;
}

/** Data-driven fact established once its chunk index is revealed. */
export interface EngineFactEstablishment {
  fact: string;
  revealed_at_chunk_index: number;
}

/** Premature-action rule with optional acknowledgment requirement (Slice 03). */
export interface EngineSufficiencyDependency {
  action_type: 'SUBMIT_FINAL_ANSWER';
  requires_facts: string[];
  misconception_code: string;
  requires_acknowledgment: boolean;
  message: string;
}

/** One selectable answer choice for a step; wrong choices may carry a misconception code. */
export interface EngineStepOption {
  slot: Slot;
  label: string;
  misconception_code?: string | null;
}

/** One ordered reasoning step: a token to be placed in its one correct slot. */
export interface EngineStep {
  step_pos: number;
  token_id: string;
  correct_slot: Slot;
  /** Highest chunk index that must already be revealed for the step to be active. */
  requires_revealed_chunk_index: number;
  /** Human-safe label persisted into the workspace (never hidden content). */
  label: string;
  /** Authored answer set shown to the student for this step. */
  options: EngineStepOption[];
}

/** Fixture-/DB-defined deterministic rollback rule (Slice 04 / EX-04). */
export interface EngineRollbackRule {
  misconception_code: string;
  /** Fire when the session's equivalent-error count reaches this value (inclusive). */
  repeat_from: number;
  rollback_depth: number;
  guidance_code: string;
}

/** Record describing a rollback that must be persisted atomically with the attempt. */
export interface EngineRollbackRecord {
  misconception_code: string;
  from_chunk_index: number;
  to_chunk_index: number;
  rollback_depth: number;
  repeat_count: number;
  guidance_code: string;
}

/** The slice-relevant projection of a problem's immutable `definition` jsonb. */
export interface EngineProblemDefinition {
  problem_key: string;
  /** Slots this problem version exposes in the typed workspace. */
  workspace_slots: Slot[];
  /** Ordered reasoning steps (change-28-jul.txt): exactly one is ever active at a time. */
  steps: EngineStep[];
  /** Facts established by reveal position (data-driven sufficiency). */
  fact_establishments: EngineFactEstablishment[];
  /** Actions blocked until named facts are established. */
  sufficiency_dependencies: EngineSufficiencyDependency[];
  /** Number of chunks in the problem (bounds the reveal index). */
  chunk_count: number;
  /** Commitment gates that unlock the next chunk (data-driven reveal). */
  gates: EngineGate[];
  /** Structural slots that must be filled before a final answer is allowed. */
  completion_rule: { requires_slots_filled: Slot[] };
  /** Server-only expected numeric/string result (never serialized publicly). */
  expected_final_result: { value: string; unit: string };
  /** Deterministic rollback rules for this problem version (may be empty). */
  rollback_rules: EngineRollbackRule[];
}

export interface PendingAcknowledgment {
  misconception_code: string;
  message: string;
}

export interface WorkspaceState {
  slots: Array<{ slot: Slot; token_id: string | null; label: string | null }>;
  /** When set, progressing actions are blocked until acknowledgment (PB-010). */
  pending_acknowledgment: PendingAcknowledgment | null;
}

export interface EngineSessionState {
  status: 'ACTIVE' | 'COMPLETED' | 'ABANDONED';
  /** Highest revealed chunk index (0-based). */
  current_chunk_index: number;
  workspace: WorkspaceState;
  accepted_commitments: string[];
}

export interface EngineAction {
  action_type: ActionType;
  payload: { slot?: Slot; token_id?: string; value?: string };
}

export interface EngineEvent {
  event_type: string;
  chunk_index: number | null;
  misconception_code: string | null;
  payload: Record<string, unknown>;
}

export type ActionOutcome = 'ACCEPTED' | 'REJECTED';

export interface EngineResult {
  outcome: ActionOutcome;
  /**
   * Next durable state. Identical to input on a pure reject; may change
   * guidance/acknowledgment/rollback fields without advancing reveal forward
   * (ARCHITECTURE §8).
   */
  nextState: EngineSessionState;
  events: EngineEvent[];
  misconception_code: string | null;
  /** Safe message surfaced to the client; never hidden content. */
  message: string | null;
  /** Guidance code when a rollback rule fires; otherwise null. */
  guidance_code: string | null;
  /** Present when a deterministic rollback must be persisted with this attempt. */
  rollback: EngineRollbackRecord | null;
}
