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

/** Answer the current step by clicking one of its curated options (change-28-jul.txt). */
async function answerStep(page: Page, slot: string): Promise<void> {
  await page.getByTestId(`current-step-option-${slot}`).click();
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
  await answerStep(page, 'WHOLE');
  await continueWhenReady(page);
  await answerStep(page, 'PART_IN_PERCENTAGE');
  await continueWhenReady(page);
  await answerStep(page, 'UNKNOWN');
  await page.getByTestId('final-answer-input').fill('12');
  await page.getByTestId('submit-answer').click();
  await expect(page.getByTestId('completed')).toBeVisible();
  await page.getByTestId('back-dashboard').click();
}

async function completeEx02(page: Page): Promise<void> {
  await startProblem(page);
  await answerStep(page, 'RATIO');
  await continueWhenReady(page);
  await answerStep(page, 'PART_IN_NUMBER');
  await continueWhenReady(page);
  await answerStep(page, 'UNKNOWN');
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
  await expect(page.getByTestId('current-step')).toContainText('40 students');

  // Place 40 in Part-in-number → rejected/classified. Stays on step 1.
  await answerStep(page, 'PART_IN_NUMBER');
  await expect(page.getByTestId('message')).toBeVisible();
  await expect(page.getByTestId('completed-step-1')).toHaveCount(0);

  // Valid Whole → reveal chunk 1.
  await answerStep(page, 'WHOLE');
  await continueWhenReady(page);
  await expect(page.getByTestId('chunk-1')).toBeVisible();

  // Attempt 30% in Whole while occupied (API — the UI only exposes options for
  // the current step, not arbitrary re-targeting of an already-answered slot).
  // Conflict remains: WHOLE still holds 40 students.
  await assignViaApi(page, 'ex04-c1-percent', 'WHOLE');
  await expect(page.getByTestId('message')).toBeVisible();
  await expect(page.getByTestId('completed-step-1')).toContainText('40 students');
  await expect(page.getByTestId('guidance-code')).toHaveCount(0);

  // Explicit delete, then repeat equivalent error via API → deterministic rollback.
  await page.getByTestId('delete-WHOLE').click();
  await expect(page.getByTestId('completed-step-1')).toHaveCount(0);

  await assignViaApi(page, 'ex04-c1-percent', 'WHOLE');
  await expect(page.getByTestId('guidance-code')).toHaveText('GUIDE_DELETE_CONFLICT');
  await expect(page.getByTestId('message')).toBeVisible();
  await expect(page.getByTestId('chunk-1')).toHaveCount(0);
  await expect(page.getByTestId('chunk-0')).toBeVisible();

  // Recover and complete.
  await answerStep(page, 'WHOLE');
  await continueWhenReady(page);
  await expect(page.getByTestId('chunk-1')).toBeVisible();
  await answerStep(page, 'PART_IN_PERCENTAGE');
  await continueWhenReady(page);
  await expect(page.getByTestId('chunk-2')).toBeVisible();
  await answerStep(page, 'UNKNOWN');
  await page.getByTestId('final-answer-input').fill('12');
  await page.getByTestId('submit-answer').click();
  await expect(page.getByTestId('completed')).toBeVisible();
  await expect(page.getByTestId('status')).toHaveText('COMPLETED');
});
