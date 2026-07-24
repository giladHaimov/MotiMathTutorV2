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

  await page.getByTestId('token-ex01-c0-whole').click();
  await page.getByTestId('assign-WHOLE').click();

  await expect(page.getByTestId('retry-action')).toBeVisible();
  await expect(page.getByTestId('message')).toContainText(/Network error/i);
  // State must not have advanced in the UI yet (response was lost).
  await expect(page.getByTestId('state-version')).toHaveText('0');

  await page.getByTestId('retry-action').click();
  await expect(page.getByTestId('state-version')).toHaveText('1');
  await expect(page.getByTestId('slot-label-WHOLE')).toHaveText('40 students');
  await expect(page.getByTestId('retry-action')).toHaveCount(0);

  expect(actionBodies.length).toBe(2);
  expect(actionBodies[0]!.client_action_id).toBe(actionBodies[1]!.client_action_id);
});

/**
 * AC-048 after refresh: pending action + client_action_id survive reload; retry
 * is exactly-once against the already-committed server attempt.
 */
test('AC-048 pending action survives refresh and retries exactly once', async ({ page }) => {
  await register(page, 'Retry After Refresh');
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

  await page.getByTestId('token-ex01-c0-whole').click();
  await page.getByTestId('assign-WHOLE').click();
  await expect(page.getByTestId('retry-action')).toBeVisible();
  const originalId = await page.getByTestId('pending-action-id').innerText();
  expect(originalId.length).toBeGreaterThan(10);

  const storedBefore = await page.evaluate(() =>
    localStorage.getItem('reasoning_tutor_pending_action'),
  );
  expect(storedBefore).toContain(originalId);

  await page.reload();
  await expect(page.getByTestId('dashboard')).toBeVisible();
  await page.getByTestId('resume-session').click();
  await expect(page.getByTestId('problem-screen')).toBeVisible();
  await expect(page.getByTestId('retry-action')).toBeVisible();
  await expect(page.getByTestId('pending-action-id')).toHaveText(originalId);
  // Authoritative resume loads server state (already advanced); pending retry remains.
  await expect(page.getByTestId('state-version')).toHaveText('1');
  await expect(page.getByTestId('slot-label-WHOLE')).toHaveText('40 students');

  await page.getByTestId('retry-action').click();
  await expect(page.getByTestId('state-version')).toHaveText('1');
  await expect(page.getByTestId('slot-label-WHOLE')).toHaveText('40 students');
  await expect(page.getByTestId('retry-action')).toHaveCount(0);
  await expect(page.getByTestId('pending-action-id')).toHaveCount(0);

  expect(actionBodies.length).toBe(2);
  expect(actionBodies[0]!.client_action_id).toBe(originalId);
  expect(actionBodies[1]!.client_action_id).toBe(originalId);

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

  await page.getByTestId('token-ex01-c0-whole').click();
  await page.getByTestId('assign-WHOLE').click();
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
  await expect(page.getByTestId('slot-label-WHOLE')).toHaveText('40 students');
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

  await page.getByTestId('token-ex01-c0-whole').click();
  await page.getByTestId('assign-WHOLE').click();
  await expect(page.getByTestId('final-answer')).toHaveCount(0);
});

test('refresh resume restores authoritative problem state (AC-049)', async ({ page }) => {
  await register(page, 'Refresh Resume');
  await page.getByTestId('start-session').click();
  await page.getByTestId('token-ex01-c0-whole').click();
  await page.getByTestId('assign-WHOLE').click();
  await expect(page.getByTestId('state-version')).toHaveText('1');

  await page.reload();
  await expect(page.getByTestId('dashboard')).toBeVisible();
  await page.getByTestId('resume-session').click();
  await expect(page.getByTestId('problem-screen')).toBeVisible();
  await expect(page.getByTestId('state-version')).toHaveText('1');
  await expect(page.getByTestId('slot-label-WHOLE')).toHaveText('40 students');
});
