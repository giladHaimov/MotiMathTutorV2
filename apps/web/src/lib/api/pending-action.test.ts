import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  PENDING_ACTION_STORAGE_KEY,
  clearPendingAction,
  createPendingAction,
  loadPendingAction,
  parsePendingAction,
  savePendingAction,
  shouldClearPendingOnAuthFailure,
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
      '11111111-1111-4111-8111-111111111111',
      'ASSIGN_SLOT',
      { slot: 'WHOLE', token_id: 't1' },
      3,
      '22222222-2222-4222-8222-222222222222',
    );
    expect(pending.session_id).toBe('11111111-1111-4111-8111-111111111111');
    expect(pending.client_action_id).toBe('22222222-2222-4222-8222-222222222222');
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

  it('clears pending on auth failure only for 401', () => {
    expect(shouldClearPendingOnAuthFailure(401)).toBe(true);
    expect(shouldClearPendingOnAuthFailure(null)).toBe(false);
    expect(shouldClearPendingOnAuthFailure(500)).toBe(false);
    expect(shouldClearPendingOnAuthFailure(503)).toBe(false);
  });

  it('persists and restores the exact client_action_id across reload', () => {
    const pending = createPendingAction(
      '11111111-1111-4111-8111-111111111111',
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

  it('rejects malformed stored payloads and clears corrupt storage', () => {
    expect(parsePendingAction('{')).toBeNull();
    expect(parsePendingAction('{"session_id":"x"}')).toBeNull();
    expect(
      parsePendingAction(
        JSON.stringify({
          session_id: 'not-a-uuid',
          client_action_id: '22222222-2222-4222-8222-222222222222',
          expected_state_version: 0,
          action_type: 'ASSIGN_SLOT',
          payload: {},
        }),
      ),
    ).toBeNull();
    expect(
      parsePendingAction(
        JSON.stringify({
          session_id: '11111111-1111-4111-8111-111111111111',
          client_action_id: '22222222-2222-4222-8222-222222222222',
          expected_state_version: 0,
          action_type: 'NOT_A_REAL_ACTION',
          payload: {},
        }),
      ),
    ).toBeNull();
    expect(
      parsePendingAction(
        JSON.stringify({
          session_id: '11111111-1111-4111-8111-111111111111',
          client_action_id: '22222222-2222-4222-8222-222222222222',
          expected_state_version: 0,
          action_type: 'ASSIGN_SLOT',
          payload: { slot: 'WHOLE', token_id: 't1', extra: true },
        }),
      ),
    ).toBeNull();

    memory.set(PENDING_ACTION_STORAGE_KEY, '{"broken":true}');
    expect(loadPendingAction()).toBeNull();
    expect(memory.has(PENDING_ACTION_STORAGE_KEY)).toBe(false);
  });
});
