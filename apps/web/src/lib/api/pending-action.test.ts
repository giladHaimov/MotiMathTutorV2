import { describe, expect, it } from 'vitest';
import { createPendingAction, shouldRetainPendingForRetry } from './pending-action.js';

describe('pending action retry helpers (AC-048)', () => {
  it('creates a pending action with a stable client_action_id', () => {
    const pending = createPendingAction(
      'ASSIGN_SLOT',
      { slot: 'WHOLE', token_id: 't1' },
      3,
      '11111111-1111-4111-8111-111111111111',
    );
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
});
