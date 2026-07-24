import type { ActionPayload, ActionType } from '@app/contracts';

/**
 * In-flight action retained across network loss so retries reuse the same
 * `client_action_id` (PB-016 / AC-048). Cleared on success or authoritative
 * conflict reconciliation — never regenerated for a retry of the same submit.
 */
export interface PendingAction {
  client_action_id: string;
  expected_state_version: number;
  action_type: ActionType;
  payload: ActionPayload;
}

export function createPendingAction(
  actionType: ActionType,
  payload: ActionPayload,
  expectedStateVersion: number,
  clientActionId: string,
): PendingAction {
  return {
    client_action_id: clientActionId,
    expected_state_version: expectedStateVersion,
    action_type: actionType,
    payload,
  };
}

/** True when a failed submit should keep the pending action for Retry. */
export function shouldRetainPendingForRetry(status: number | null): boolean {
  // Network failure (no HTTP status) or server error: retry safely with same ID.
  if (status === null) return true;
  return status >= 500;
}
