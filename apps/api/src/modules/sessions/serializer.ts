import { publicSessionSchema, type PublicSession } from '@app/contracts';
import {
  computeActiveStep,
  computeAllowedActions,
  computeCompletedSteps,
  computeRequiredNextAction,
  type EngineProblemDefinition,
  type WorkspaceState,
} from '@app/engine';

export interface ChunkRow {
  orderIndex: number;
  chunkType: string;
  content: string;
  tokens: Array<{ token_id: string; text: string }>;
}

export interface SerializeInput {
  sessionId: string;
  stateVersion: number;
  status: 'ACTIVE' | 'COMPLETED' | 'ABANDONED';
  engineVersion: string;
  contentVersion: number;
  currentChunkIndex: number;
  workspace: WorkspaceState;
  acceptedCommitments: string[];
  chunks: ChunkRow[];
  message: string | null;
  /** Fixture guidance code when a rollback rule fires; otherwise null. */
  guidanceCode?: string | null;
  /** Projected problem definition — drives allowed_actions / required_next_action / steps. */
  problemDefinition: EngineProblemDefinition;
}

/**
 * Build the public session response as an explicit allowlist (ARCHITECTURE §6).
 *
 * Only chunks at or before `currentChunkIndex` are exposed — future hidden
 * chunks and raw full problem text can never leak (PB-002/PB-004, AC-011/012).
 * `expected_final_result` is never included. The result is re-validated against
 * the contract schema as a final guard.
 */
export function buildPublicSession(input: SerializeInput): PublicSession {
  const engineState = {
    status: input.status,
    current_chunk_index: input.currentChunkIndex,
    workspace: {
      slots: input.workspace.slots,
      pending_acknowledgment: input.workspace.pending_acknowledgment ?? null,
    },
    accepted_commitments: input.acceptedCommitments,
  };

  const allowedActions =
    input.status === 'ACTIVE' ? computeAllowedActions(input.problemDefinition, engineState) : [];
  const requiredNext =
    input.status === 'ACTIVE'
      ? computeRequiredNextAction(input.problemDefinition, engineState)
      : { action_type: null };

  const visibleChunks = input.chunks
    .filter((c) => c.orderIndex <= input.currentChunkIndex)
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((c) => ({
      order_index: c.orderIndex,
      chunk_type: c.chunkType,
      content: c.content,
      tokens: c.tokens.map((t) => ({ token_id: t.token_id, text: t.text })),
    }));

  // Ordered prior-answered steps + the single active step (change-28-jul.txt
  // goal #5) — never the full slot list, so unreached steps stay hidden.
  const completedSteps = computeCompletedSteps(input.problemDefinition, engineState);
  const currentStep = computeActiveStep(input.problemDefinition, engineState);

  const publicSession: PublicSession = {
    session_id: input.sessionId,
    state_version: input.stateVersion,
    status: input.status,
    visible_chunks: visibleChunks,
    completed_steps: completedSteps,
    current_step: currentStep,
    accepted_commitments: input.acceptedCommitments,
    required_next_action: requiredNext,
    allowed_actions: allowedActions,
    message: input.message,
    guidance_code: input.guidanceCode ?? null,
    engine_version: input.engineVersion,
    content_version: input.contentVersion,
  };

  // Fail closed if anything unexpected slipped in.
  return publicSessionSchema.parse(publicSession);
}
