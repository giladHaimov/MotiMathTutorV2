import type { PublicSession } from '@app/contracts';
import { clearPendingAction, type PendingAction } from './pending-action.js';

export type PendingReconcileResult =
  | { kind: 'cleared'; reason: 'committed' | 'completed' | 'session_mismatch' | 'absent' }
  | { kind: 'retry'; pending: PendingAction };

/**
 * Reconcile a persisted pending action against authoritative server session state
 * before rendering terminal UI (AC-048 / final-answer lost-response).
 *
 * - Server already advanced past `expected_state_version` → action was applied; clear.
 * - Session COMPLETED → clear (never strand pending behind completion UI).
 * - Same version and ACTIVE → outcome still unknown; keep for Retry with same id.
 */
export function reconcilePendingWithSession(
  session: PublicSession,
  stored: PendingAction | null,
): PendingReconcileResult {
  if (!stored) {
    return { kind: 'cleared', reason: 'absent' };
  }

  if (stored.session_id !== session.session_id) {
    clearPendingAction();
    return { kind: 'cleared', reason: 'session_mismatch' };
  }

  if (session.status === 'COMPLETED') {
    clearPendingAction();
    return { kind: 'cleared', reason: 'completed' };
  }

  if (session.state_version > stored.expected_state_version) {
    clearPendingAction();
    return { kind: 'cleared', reason: 'committed' };
  }

  return { kind: 'retry', pending: stored };
}
