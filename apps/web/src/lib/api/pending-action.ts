import type { ActionPayload, ActionType } from '@app/contracts';

/**
 * In-flight action retained across network loss, refresh, and app restart so
 * retries reuse the same `client_action_id` (PB-016 / AC-048). Cleared only
 * after a known server outcome (success or authoritative conflict).
 */
export interface PendingAction {
  session_id: string;
  client_action_id: string;
  expected_state_version: number;
  action_type: ActionType;
  payload: ActionPayload;
}

export const PENDING_ACTION_STORAGE_KEY = 'reasoning_tutor_pending_action';

export function createPendingAction(
  sessionId: string,
  actionType: ActionType,
  payload: ActionPayload,
  expectedStateVersion: number,
  clientActionId: string,
): PendingAction {
  return {
    session_id: sessionId,
    client_action_id: clientActionId,
    expected_state_version: expectedStateVersion,
    action_type: actionType,
    payload,
  };
}

/** True when a failed submit should keep the pending action for Retry. */
export function shouldRetainPendingForRetry(status: number | null): boolean {
  if (status === null) return true;
  return status >= 500;
}

export function parsePendingAction(raw: string | null | undefined): PendingAction | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<PendingAction>;
    if (
      typeof data.session_id !== 'string' ||
      typeof data.client_action_id !== 'string' ||
      typeof data.expected_state_version !== 'number' ||
      typeof data.action_type !== 'string' ||
      data.payload === undefined
    ) {
      return null;
    }
    return data as PendingAction;
  } catch {
    return null;
  }
}

/**
 * Persist pending action in localStorage (survives browser refresh and Capacitor
 * WebView process restart). Auth secrets never go here — only retry metadata.
 */
export function savePendingAction(action: PendingAction): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(PENDING_ACTION_STORAGE_KEY, JSON.stringify(action));
}

export function loadPendingAction(): PendingAction | null {
  if (typeof localStorage === 'undefined') return null;
  return parsePendingAction(localStorage.getItem(PENDING_ACTION_STORAGE_KEY));
}

export function clearPendingAction(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(PENDING_ACTION_STORAGE_KEY);
}
