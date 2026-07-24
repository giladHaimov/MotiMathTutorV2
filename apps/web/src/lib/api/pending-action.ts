import {
  actionPayloadSchema,
  actionTypeSchema,
  type ActionPayload,
  type ActionType,
} from '@app/contracts';
import { z } from 'zod';

/**
 * In-flight action retained across network loss, refresh, and app restart so
 * retries reuse the same `client_action_id` (PB-016 / AC-048). Cleared only
 * after a known server outcome (success or authoritative conflict), or a
 * definitive 401 logout — never on transient network failure during boot.
 */
export interface PendingAction {
  session_id: string;
  client_action_id: string;
  expected_state_version: number;
  action_type: ActionType;
  payload: ActionPayload;
}

export const PENDING_ACTION_STORAGE_KEY = 'reasoning_tutor_pending_action';

/** Strict validation before any Retry uses restored pending state. */
export const pendingActionSchema = z
  .object({
    session_id: z.string().uuid(),
    client_action_id: z.string().uuid(),
    expected_state_version: z.number().int().min(0),
    action_type: actionTypeSchema,
    payload: actionPayloadSchema,
  })
  .strict();

export function createPendingAction(
  sessionId: string,
  actionType: ActionType,
  payload: ActionPayload,
  expectedStateVersion: number,
  clientActionId: string,
): PendingAction {
  return pendingActionSchema.parse({
    session_id: sessionId,
    client_action_id: clientActionId,
    expected_state_version: expectedStateVersion,
    action_type: actionType,
    payload,
  });
}

/** True when a failed submit should keep the pending action for Retry. */
export function shouldRetainPendingForRetry(status: number | null): boolean {
  if (status === null) return true;
  return status >= 500;
}

/** Clear durable pending only on definitive unauthenticated outcome, not network blips. */
export function shouldClearPendingOnAuthFailure(status: number | null): boolean {
  return status === 401;
}

export function parsePendingAction(raw: string | null | undefined): PendingAction | null {
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    const parsed = pendingActionSchema.safeParse(data);
    return parsed.success ? parsed.data : null;
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
  localStorage.setItem(
    PENDING_ACTION_STORAGE_KEY,
    JSON.stringify(pendingActionSchema.parse(action)),
  );
}

export function loadPendingAction(): PendingAction | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(PENDING_ACTION_STORAGE_KEY);
  const parsed = parsePendingAction(raw);
  if (raw && !parsed) {
    localStorage.removeItem(PENDING_ACTION_STORAGE_KEY);
  }
  return parsed;
}

export function clearPendingAction(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(PENDING_ACTION_STORAGE_KEY);
}
