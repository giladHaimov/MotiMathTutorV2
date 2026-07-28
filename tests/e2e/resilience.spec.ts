import type { Page } from '@playwright/test';
import { expect, test } from './fixtures.js';

async function register(page: Page, label: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('auth-view')).toBeVisible();
  await page.getByTestId('toggle-mode').click();
  await page.getByTestId('name').fill(label);
  await page
    .getByTestId('email')
    .fill(
      `${label.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
    );
  await page.getByTestId('password').fill('Passw0rd!123');
  await page.getByTestId('submit-auth').click();
  await expect(page.getByTestId('dashboard')).toBeVisible();
}

/** Answer the current step by clicking one of its curated options (change-28-jul.txt). */
async function answerStep(page: Page, slot: string): Promise<void> {
  await page.getByTestId(`current-step-option-${slot}`).click();
}

async function continueWhenReady(page: Page): Promise<void> {
  await expect(page.getByTestId('continue')).toBeEnabled();
  await page.getByTestId('continue').click();
}

/**
 * SCN / AC-048: response lost after the server accepted the action; client retries
 * with the same `client_action_id` and state advances once.
 */
test('AC-048 lost response then retry reuses same client_action_id', async ({ page }) => {
  await register(page, 'Retry Safe');
  await page.getByTestId('start-session').click();
  await expect(page.getByTestId('problem-screen')).toBeVisible();
  await expect(page.getByTestId('state-version')).toHaveText('0');

  const actionBodies: Array<{ client_action_id: string }> = [];
  let droppedFirst = false;

  await page.route('**/api/sessions/*/actions', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const body = route.request().postDataJSON() as { client_action_id: string };
    actionBodies.push({ client_action_id: body.client_action_id });

    if (!droppedFirst) {
      droppedFirst = true;
      // Server processes the action; client never sees the response (lost reply).
      await route.fetch();
      await route.abort('connectionfailed');
      return;
    }
    await route.continue();
  });

  await answerStep(page, 'WHOLE');

  await expect(page.getByTestId('retry-action')).toBeVisible();
  await expect(page.getByTestId('message')).toContainText(/Network error/i);
  // State must not have advanced in the UI yet (response was lost).
  await expect(page.getByTestId('state-version')).toHaveText('0');

  await page.getByTestId('retry-action').click();
  await expect(page.getByTestId('state-version')).toHaveText('1');
  await expect(page.getByTestId('completed-step-1')).toContainText('40 students');
  await expect(page.getByTestId('retry-action')).toHaveCount(0);

  expect(actionBodies.length).toBe(2);
  expect(actionBodies[0]!.client_action_id).toBe(actionBodies[1]!.client_action_id);
});

/**
 * AC-048 after refresh when server already committed: pending is reconciled/cleared;
 * authoritative state is shown; no duplicate retry attempt.
 */
test('AC-048 committed pending is cleared on resume (no duplicate)', async ({ page }) => {
  await register(page, 'Reconcile After Refresh');
  await page.getByTestId('start-session').click();
  await expect(page.getByTestId('problem-screen')).toBeVisible();

  const actionBodies: Array<{ client_action_id: string }> = [];
  let droppedFirst = false;

  await page.route('**/api/sessions/*/actions', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const body = route.request().postDataJSON() as { client_action_id: string };
    actionBodies.push({ client_action_id: body.client_action_id });

    if (!droppedFirst) {
      droppedFirst = true;
      await route.fetch();
      await route.abort('connectionfailed');
      return;
    }
    await route.continue();
  });

  await answerStep(page, 'WHOLE');
  await expect(page.getByTestId('retry-action')).toBeVisible();
  const originalId = await page.getByTestId('pending-action-id').innerText();
  expect(originalId.length).toBeGreaterThan(10);

  const storedBefore = await page.evaluate(() =>
    localStorage.getItem('reasoning_tutor_pending_action'),
  );
  expect(storedBefore).toContain(originalId);

  await page.reload();
  // Boot opens the pending session and reconciles: authoritative state, pending cleared.
  await expect(page.getByTestId('problem-screen')).toBeVisible();
  await expect(page.getByTestId('state-version')).toHaveText('1');
  await expect(page.getByTestId('completed-step-1')).toContainText('40 students');
  await expect(page.getByTestId('retry-action')).toHaveCount(0);
  await expect(page.getByTestId('pending-action-id')).toHaveCount(0);

  expect(actionBodies.length).toBe(1);
  expect(actionBodies[0]!.client_action_id).toBe(originalId);

  const storedAfter = await page.evaluate(() =>
    localStorage.getItem('reasoning_tutor_pending_action'),
  );
  expect(storedAfter).toBeNull();
});

/**
 * Final-answer lost response: server COMPLETED → refresh → reconcile clears pending;
 * COMPLETED UI; no duplicate SUBMIT_FINAL_ANSWER.
 */
test('final-answer lost response reconciles to COMPLETED without duplicate', async ({ page }) => {
  await register(page, 'Final Answer Reconcile');
  await page.getByTestId('start-session').click();
  await expect(page.getByTestId('problem-screen')).toBeVisible();

  await answerStep(page, 'WHOLE');
  await continueWhenReady(page);
  await answerStep(page, 'PART_IN_PERCENTAGE');
  await continueWhenReady(page);
  await answerStep(page, 'UNKNOWN');
  await expect(page.getByTestId('final-answer-input')).toBeVisible();

  const actionBodies: Array<{ client_action_id: string; action_type: string }> = [];
  let droppedFinal = false;

  await page.route('**/api/sessions/*/actions', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const body = route.request().postDataJSON() as {
      client_action_id: string;
      action_type: string;
    };
    actionBodies.push({
      client_action_id: body.client_action_id,
      action_type: body.action_type,
    });

    if (body.action_type === 'SUBMIT_FINAL_ANSWER' && !droppedFinal) {
      droppedFinal = true;
      await route.fetch();
      await route.abort('connectionfailed');
      return;
    }
    await route.continue();
  });

  await page.getByTestId('final-answer-input').fill('12');
  await page.getByTestId('submit-answer').click();
  await expect(page.getByTestId('retry-action')).toBeVisible();
  const pendingId = await page.getByTestId('pending-action-id').innerText();

  const storedBefore = await page.evaluate(() =>
    localStorage.getItem('reasoning_tutor_pending_action'),
  );
  expect(storedBefore).toContain(pendingId);

  await page.reload();
  // Boot opens the pending session and reconciles to authoritative COMPLETED
  // (dashboard has no resume for COMPLETED sessions).
  await expect(page.getByTestId('problem-screen')).toBeVisible();
  await expect(page.getByTestId('completed')).toBeVisible();
  await expect(page.getByTestId('status')).toHaveText('COMPLETED');
  await expect(page.getByTestId('retry-action')).toHaveCount(0);
  await expect(page.getByTestId('pending-action-id')).toHaveCount(0);

  const finals = actionBodies.filter((b) => b.action_type === 'SUBMIT_FINAL_ANSWER');
  expect(finals.length).toBe(1);
  expect(finals[0]!.client_action_id).toBe(pendingId);

  const storedAfter = await page.evaluate(() =>
    localStorage.getItem('reasoning_tutor_pending_action'),
  );
  expect(storedAfter).toBeNull();
});

/**
 * Stale-version conflict: UI reconciles to authoritative current_state (AC-018 client path).
 */
test('stale version conflict reconciles UI to authoritative state', async ({ page }) => {
  await register(page, 'Conflict UI');
  await page.getByTestId('start-session').click();
  await expect(page.getByTestId('problem-screen')).toBeVisible();

  await answerStep(page, 'WHOLE');
  await expect(page.getByTestId('state-version')).toHaveText('1');

  // Force the next action to claim an old expected_state_version.
  await page.route('**/api/sessions/*/actions', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const body = route.request().postDataJSON() as Record<string, unknown>;
    await route.continue({
      postData: JSON.stringify({ ...body, expected_state_version: 0 }),
    });
  });

  await page.getByTestId('continue').click();
  await expect(page.getByTestId('message')).toBeVisible();
  await expect(page.getByTestId('state-version')).toHaveText('1');
  await expect(page.getByTestId('completed-step-1')).toContainText('40 students');
  await expect(page.getByTestId('chunk-1')).toHaveCount(0);
});

/**
 * AC-050: UI never invents final-answer availability — only server allowed_actions.
 */
test('AC-050 final answer control absent until server allows it', async ({ page }) => {
  await register(page, 'No Client Validity');
  await page.getByTestId('start-session').click();
  await expect(page.getByTestId('problem-screen')).toBeVisible();
  await expect(page.getByTestId('final-answer')).toHaveCount(0);
  await expect(page.getByTestId('submit-answer')).toHaveCount(0);

  await answerStep(page, 'WHOLE');
  await expect(page.getByTestId('final-answer')).toHaveCount(0);
});

test('refresh resume restores authoritative problem state (AC-049)', async ({ page }) => {
  await register(page, 'Refresh Resume');
  await page.getByTestId('start-session').click();
  await answerStep(page, 'WHOLE');
  await expect(page.getByTestId('state-version')).toHaveText('1');

  await page.reload();
  await expect(page.getByTestId('dashboard')).toBeVisible();
  await page.getByTestId('resume-session').click();
  await expect(page.getByTestId('problem-screen')).toBeVisible();
  await expect(page.getByTestId('state-version')).toHaveText('1');
  await expect(page.getByTestId('completed-step-1')).toContainText('40 students');
});
