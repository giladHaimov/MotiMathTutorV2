import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PublicSession } from '@app/contracts';
import { reconcilePendingWithSession } from './reconcile-pending.js';
import type { PendingAction } from './pending-action.js';

function session(
  partial: Partial<PublicSession> & Pick<PublicSession, 'session_id'>,
): PublicSession {
  return {
    status: 'ACTIVE',
    state_version: 0,
    problem_id: 'EX-01',
    visible_chunks: [],
    workspace: { slots: [] },
    accepted_commitments: [],
    required_next_action: { action_type: null },
    allowed_actions: [],
    guidance_code: null,
    message: null,
    ...partial,
  } as PublicSession;
}

function pending(partial: Partial<PendingAction> = {}): PendingAction {
  return {
    session_id: '11111111-1111-4111-8111-111111111111',
    client_action_id: '22222222-2222-4222-8222-222222222222',
    expected_state_version: 0,
    action_type: 'SUBMIT_FINAL_ANSWER',
    payload: { value: '12' },
    ...partial,
  };
}

describe('reconcilePendingWithSession', () => {
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

  it('clears when absent', () => {
    expect(
      reconcilePendingWithSession(
        session({ session_id: '11111111-1111-4111-8111-111111111111' }),
        null,
      ),
    ).toEqual({
      kind: 'cleared',
      reason: 'absent',
    });
  });

  it('clears on session mismatch', () => {
    const result = reconcilePendingWithSession(
      session({ session_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
      pending(),
    );
    expect(result).toEqual({ kind: 'cleared', reason: 'session_mismatch' });
  });

  it('clears when server already committed (state_version advanced)', () => {
    const result = reconcilePendingWithSession(
      session({
        session_id: pending().session_id,
        state_version: 1,
        status: 'ACTIVE',
      }),
      pending({ expected_state_version: 0 }),
    );
    expect(result).toEqual({ kind: 'cleared', reason: 'committed' });
  });

  it('clears when session is COMPLETED (never strand final-answer pending)', () => {
    const result = reconcilePendingWithSession(
      session({
        session_id: pending().session_id,
        state_version: 5,
        status: 'COMPLETED',
      }),
      pending({ expected_state_version: 4, action_type: 'SUBMIT_FINAL_ANSWER' }),
    );
    expect(result).toEqual({ kind: 'cleared', reason: 'completed' });
  });

  it('keeps retry when outcome still unknown (same state_version)', () => {
    const stored = pending({ expected_state_version: 3 });
    const result = reconcilePendingWithSession(
      session({
        session_id: stored.session_id,
        state_version: 3,
        status: 'ACTIVE',
      }),
      stored,
    );
    expect(result).toEqual({ kind: 'retry', pending: stored });
  });
});
