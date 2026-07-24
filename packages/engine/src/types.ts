import type { ActionType, Slot } from '@app/contracts';

/**
 * Structural inputs/outputs for the pure reasoning engine.
 *
 * The engine performs NO I/O (ARCHITECTURE §8). The session service loads the
 * pinned problem definition and durable state, calls {@link applyAction}, and
 * owns the transaction that persists the result.
 */

/** The slice-relevant projection of a problem's immutable `definition` jsonb. */
export interface EngineProblemDefinition {
  problem_key: string;
  /** Slots this problem version exposes in the typed workspace. */
  workspace_slots: Slot[];
  /** Which token may be placed into which slot, and the chunk that must be revealed first. */
  assignable: Array<{
    token_id: string;
    slot: Slot;
    /** Highest chunk index that must already be revealed for the assignment to be permitted. */
    requires_revealed_chunk_index: number;
    /** Human-safe label persisted into the workspace (never hidden content). */
    label: string;
  }>;
  /** Number of chunks in the problem (bounds the reveal index). */
  chunk_count: number;
}

export interface WorkspaceState {
  slots: Array<{ slot: Slot; token_id: string | null; label: string | null }>;
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
  /** Next durable state. Identical to input state when the action is rejected. */
  nextState: EngineSessionState;
  events: EngineEvent[];
  misconception_code: string | null;
  /** Safe message surfaced to the client; never hidden content. */
  message: string | null;
}
