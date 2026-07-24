import { publicSessionSchema, type PublicSession, type Slot } from '@app/contracts';
import {
  computeAllowedActions,
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
  workspaceSlots: Slot[];
  workspace: WorkspaceState;
  acceptedCommitments: string[];
  chunks: ChunkRow[];
  message: string | null;
  /** Projected problem definition — drives allowed_actions / required_next_action. */
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
    workspace: input.workspace,
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

  const slots = input.workspaceSlots.map((slot) => {
    const filled = input.workspace.slots.find((s) => s.slot === slot);
    return {
      slot,
      token_id: filled?.token_id ?? null,
      label: filled?.label ?? null,
    };
  });

  const publicSession: PublicSession = {
    session_id: input.sessionId,
    state_version: input.stateVersion,
    status: input.status,
    visible_chunks: visibleChunks,
    workspace: { slots },
    accepted_commitments: input.acceptedCommitments,
    required_next_action: requiredNext,
    allowed_actions: allowedActions,
    message: input.message,
    engine_version: input.engineVersion,
    content_version: input.contentVersion,
  };

  // Fail closed if anything unexpected slipped in.
  return publicSessionSchema.parse(publicSession);
}
