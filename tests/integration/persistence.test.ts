import { afterAll, describe, expect, it } from 'vitest';
import { makeApp, registerUser, newUuid } from '../helpers/app.js';
import { closePool } from '../../apps/api/src/db/index.js';
import type { PublicSession } from '@app/contracts';

afterAll(async () => {
  await closePool();
});

describe('durable persistence across backend restart (AC-022, SCN-11)', () => {
  it('resumes exact workspace + reveal state after the app is rebuilt', async () => {
    // --- App instance A: start a session and apply one action ---
    const appA = await makeApp();
    const user = await registerUser(appA);
    const started = (
      await appA.inject({
        method: 'POST',
        url: '/api/sessions',
        headers: { cookie: user.cookie },
      })
    ).json() as PublicSession;

    const token = started.visible_chunks[0]!.tokens[0]!.token_id;
    const applied = (
      await appA.inject({
        method: 'POST',
        url: `/api/sessions/${started.session_id}/actions`,
        headers: { cookie: user.cookie },
        payload: {
          client_action_id: newUuid(),
          expected_state_version: started.state_version,
          action_type: 'ASSIGN_SLOT',
          payload: { slot: 'WHOLE', token_id: token },
        },
      })
    ).json() as PublicSession;
    expect(applied.state_version).toBe(1);

    // Simulate a full backend restart: tear down app + pool entirely.
    await appA.close();
    await closePool();

    // --- App instance B: brand new process-equivalent, no in-memory carryover ---
    const appB = await makeApp();
    const resumed = (
      await appB.inject({
        method: 'GET',
        url: `/api/sessions/${started.session_id}`,
        headers: { cookie: user.cookie },
      })
    ).json() as PublicSession;

    expect(resumed.session_id).toBe(started.session_id);
    expect(resumed.state_version).toBe(1);
    expect(resumed.completed_steps.find((s) => s.correct_slot === 'WHOLE')?.token_id).toBe(token);
    expect(resumed.visible_chunks).toHaveLength(1);

    await appB.close();
  });
});
