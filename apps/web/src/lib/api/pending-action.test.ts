import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  PENDING_ACTION_STORAGE_KEY,
  clearPendingAction,
  createPendingAction,
  loadPendingAction,
  parsePendingAction,
  savePendingAction,
  shouldRetainPendingForRetry,
} from './pending-action.js';

describe('pending action retry helpers (AC-048)', () => {
  const memory = new Map<string, string>();

  beforeEach(() => {
    memory.clear();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => memory.get(k) ?? null,
        setItem: (k: string, v: string) => {
          memory.set(k, v);
        },
        removeItem: (k: string) => {
          memory.delete(k);
        },
      },
    });
  });

  afterEach(() => {
    // @ts-expect-error test cleanup
    delete globalThis.localStorage;
  });

  it('creates a pending action with session_id and stable client_action_id', () => {
    const pending = createPendingAction(
      'session-1',
      'ASSIGN_SLOT',
      { slot: 'WHOLE', token_id: 't1' },
      3,
      '11111111-1111-4111-8111-111111111111',
    );
    expect(pending.session_id).toBe('session-1');
    expect(pending.client_action_id).toBe('11111111-1111-4111-8111-111111111111');
    expect(pending.expected_state_version).toBe(3);
    expect(pending.action_type).toBe('ASSIGN_SLOT');
  });

  it('retains pending for network failure and 5xx only', () => {
    expect(shouldRetainPendingForRetry(null)).toBe(true);
    expect(shouldRetainPendingForRetry(500)).toBe(true);
    expect(shouldRetainPendingForRetry(503)).toBe(true);
    expect(shouldRetainPendingForRetry(400)).toBe(false);
    expect(shouldRetainPendingForRetry(409)).toBe(false);
    expect(shouldRetainPendingForRetry(401)).toBe(false);
  });

  it('persists and restores the exact client_action_id across reload', () => {
    const pending = createPendingAction(
      'session-1',
      'ASSIGN_SLOT',
      { slot: 'WHOLE', token_id: 't1' },
      0,
      '22222222-2222-4222-8222-222222222222',
    );
    savePendingAction(pending);
    expect(memory.get(PENDING_ACTION_STORAGE_KEY)).toContain(pending.client_action_id);

    const restored = loadPendingAction();
    expect(restored).toEqual(pending);
    expect(restored?.client_action_id).toBe(pending.client_action_id);

    clearPendingAction();
    expect(loadPendingAction()).toBeNull();
  });

  it('rejects malformed stored payloads', () => {
    expect(parsePendingAction('{')).toBeNull();
    expect(parsePendingAction('{"session_id":"x"}')).toBeNull();
  });
});
