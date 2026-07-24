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

async function startProblem(page: Page): Promise<void> {
  await page.getByTestId('start-session').click();
  await expect(page.getByTestId('problem-screen')).toBeVisible();
  await expect(page.getByTestId('chunk-0')).toBeVisible();
}

async function assignToken(page: Page, tokenId: string, slot: string): Promise<void> {
  await page.getByTestId(`token-${tokenId}`).click();
  await page.getByTestId(`assign-${slot}`).click();
}

async function continueWhenReady(page: Page): Promise<void> {
  await expect(page.getByTestId('continue')).toBeEnabled();
  await page.getByTestId('continue').click();
}

/** Submit an ASSIGN_SLOT against the real API (UI hides assign on filled slots). */
async function assignViaApi(page: Page, tokenId: string, slot: string): Promise<void> {
  await page.evaluate(
    async ({ tokenId: tid, slot: s }) => {
      const stateVersion = Number(
        (document.querySelector('[data-testid="state-version"]') as HTMLElement).textContent,
      );
      const dash = await (await fetch('/api/dashboard', { credentials: 'include' })).json();
      const sessionId = dash.active_session.session_id as string;
      await fetch(`/api/sessions/${sessionId}/actions`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_action_id: crypto.randomUUID(),
          expected_state_version: stateVersion,
          action_type: 'ASSIGN_SLOT',
          payload: { slot: s, token_id: tid },
        }),
      });
    },
    { tokenId, slot },
  );
  await page.getByTestId('reload').click();
}

async function completeEx01(page: Page): Promise<void> {
  await startProblem(page);
  await assignToken(page, 'ex01-c0-whole', 'WHOLE');
  await continueWhenReady(page);
  await assignToken(page, 'ex01-c1-percent', 'PART_IN_PERCENTAGE');
  await continueWhenReady(page);
  await assignToken(page, 'ex01-c2-unknown', 'UNKNOWN');
  await page.getByTestId('final-answer-input').fill('12');
  await page.getByTestId('submit-answer').click();
  await expect(page.getByTestId('completed')).toBeVisible();
  await page.getByTestId('back-dashboard').click();
}

async function completeEx02(page: Page): Promise<void> {
  await startProblem(page);
  await assignToken(page, 'ex02-c0-ratio', 'RATIO');
  await continueWhenReady(page);
  await assignToken(page, 'ex02-c1-blue', 'PART_IN_NUMBER');
  await continueWhenReady(page);
  await assignToken(page, 'ex02-c2-unknown', 'UNKNOWN');
  await page.getByTestId('final-answer-input').fill('10');
  await page.getByTestId('submit-answer').click();
  await expect(page.getByTestId('completed')).toBeVisible();
  await page.getByTestId('back-dashboard').click();
}

// SCN-07: EX-04 repeat misconception → deterministic rollback → recover → finish
test('SCN-07 EX-04 repeat conflict triggers rollback then recover finish 12', async ({ page }) => {
  await register(page, 'SCN Seven');
  await completeEx01(page);
  await completeEx02(page);
  await startProblem(page);
  await expect(page.getByTestId('token-ex04-c0-whole')).toBeVisible();

  // Place 40 in Part-in-number → rejected/classified.
  await assignToken(page, 'ex04-c0-whole', 'PART_IN_NUMBER');
  await expect(page.getByTestId('message')).toBeVisible();
  await expect(page.getByTestId('slot-label-PART_IN_NUMBER')).toHaveCount(0);

  // Valid Whole → reveal chunk 1.
  await assignToken(page, 'ex04-c0-whole', 'WHOLE');
  await continueWhenReady(page);
  await expect(page.getByTestId('chunk-1')).toBeVisible();

  // Attempt 30% in Whole while occupied (API — UI has no assign on filled slots).
  // Conflict remains: WHOLE still holds 40 students.
  await assignViaApi(page, 'ex04-c1-percent', 'WHOLE');
  await expect(page.getByTestId('message')).toBeVisible();
  await expect(page.getByTestId('slot-label-WHOLE')).toHaveText('40 students');
  await expect(page.getByTestId('guidance-code')).toHaveCount(0);

  // Explicit delete, then repeat equivalent error → deterministic rollback.
  await page.getByTestId('delete-WHOLE').click();
  await expect(page.getByTestId('slot-label-WHOLE')).toHaveCount(0);

  await assignToken(page, 'ex04-c1-percent', 'WHOLE');
  await expect(page.getByTestId('guidance-code')).toHaveText('GUIDE_DELETE_CONFLICT');
  await expect(page.getByTestId('message')).toBeVisible();
  await expect(page.getByTestId('chunk-1')).toHaveCount(0);
  await expect(page.getByTestId('chunk-0')).toBeVisible();

  // Recover and complete.
  await assignToken(page, 'ex04-c0-whole', 'WHOLE');
  await continueWhenReady(page);
  await expect(page.getByTestId('chunk-1')).toBeVisible();
  await assignToken(page, 'ex04-c1-percent', 'PART_IN_PERCENTAGE');
  await continueWhenReady(page);
  await expect(page.getByTestId('chunk-2')).toBeVisible();
  await assignToken(page, 'ex04-c2-unknown', 'UNKNOWN');
  await page.getByTestId('final-answer-input').fill('12');
  await page.getByTestId('submit-answer').click();
  await expect(page.getByTestId('completed')).toBeVisible();
  await expect(page.getByTestId('status')).toHaveText('COMPLETED');
});
