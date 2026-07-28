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
  await expect(page.getByTestId('chunk-1')).toHaveCount(0);
}

/** Answer the current step by clicking one of its curated options (change-28-jul.txt). */
async function answerStep(page: Page, slot: string): Promise<void> {
  await page.getByTestId(`current-step-option-${slot}`).click();
}

async function continueWhenReady(page: Page): Promise<void> {
  await expect(page.getByTestId('continue')).toBeEnabled();
  await page.getByTestId('continue').click();
}

// SCN-03: EX-01 valid Whole → percentage → Unknown → answer 12
test('SCN-03 EX-01 happy path completes with answer 12', async ({ page }) => {
  await register(page, 'SCN Three');
  await startProblem(page);

  await answerStep(page, 'WHOLE');
  await expect(page.getByTestId('completed-step-1')).toContainText('40 students');
  await continueWhenReady(page);
  await expect(page.getByTestId('chunk-1')).toBeVisible();
  await expect(page.getByTestId('chunk-2')).toHaveCount(0);

  await answerStep(page, 'PART_IN_PERCENTAGE');
  await continueWhenReady(page);
  await expect(page.getByTestId('chunk-2')).toBeVisible();

  await answerStep(page, 'UNKNOWN');
  await expect(page.getByTestId('final-answer-input')).toBeVisible();
  await page.getByTestId('final-answer-input').fill('12');
  await page.getByTestId('submit-answer').click();

  await expect(page.getByTestId('completed')).toBeVisible();
  await expect(page.getByTestId('status')).toHaveText('COMPLETED');
  await expect(page.getByTestId('result')).toBeVisible();
});

// SCN-04: wrong option on the current step is blocked (stays put, shows error),
// then the correct option advances — the core retry behavior this UI exists for.
test('SCN-04 EX-01 wrong step answer blocked then retried correctly finishes', async ({ page }) => {
  await register(page, 'SCN Four');
  await startProblem(page);

  // Step 1 ("40 students"): wrong option first — must stay on step 1 with an error.
  await answerStep(page, 'PART_IN_PERCENTAGE');
  await expect(page.getByTestId('message')).toBeVisible();
  await expect(page.getByTestId('completed-step-1')).toHaveCount(0);
  await expect(page.getByTestId('current-step')).toContainText('40 students');

  // Retry with the correct option — advances.
  await answerStep(page, 'WHOLE');
  await expect(page.getByTestId('completed-step-1')).toBeVisible();
  await continueWhenReady(page);
  await expect(page.getByTestId('chunk-1')).toBeVisible();

  // Step 2 ("30%"): same wrong→retry→correct pattern.
  await answerStep(page, 'WHOLE');
  await expect(page.getByTestId('message')).toBeVisible();
  await expect(page.getByTestId('completed-step-2')).toHaveCount(0);

  await answerStep(page, 'PART_IN_PERCENTAGE');
  await continueWhenReady(page);
  await expect(page.getByTestId('chunk-2')).toBeVisible();

  await answerStep(page, 'UNKNOWN');
  await page.getByTestId('final-answer-input').fill('12');
  await page.getByTestId('submit-answer').click();
  await expect(page.getByTestId('completed')).toBeVisible();
  await expect(page.getByTestId('status')).toHaveText('COMPLETED');
});

// Deleting a completed step returns it to "current" for re-answering (PB-007).
test('SCN-04b deleting a completed step allows re-answering it', async ({ page }) => {
  await register(page, 'SCN Four B');
  await startProblem(page);

  await answerStep(page, 'WHOLE');
  await expect(page.getByTestId('completed-step-1')).toBeVisible();

  await page.getByTestId('delete-WHOLE').click();
  await expect(page.getByTestId('completed-step-1')).toHaveCount(0);
  await expect(page.getByTestId('current-step')).toContainText('40 students');

  await answerStep(page, 'WHOLE');
  await expect(page.getByTestId('completed-step-1')).toBeVisible();
});

test('refresh during each EX-01 stage resumes authoritative state', async ({ page }) => {
  await register(page, 'SCN Resume');
  await startProblem(page);

  await answerStep(page, 'WHOLE');
  await continueWhenReady(page);
  await expect(page.getByTestId('chunk-1')).toBeVisible();
  const versionAfterCommit = await page.getByTestId('state-version').innerText();

  await page.reload();
  await expect(page.getByTestId('dashboard')).toBeVisible();
  await page.getByTestId('resume-session').click();
  await expect(page.getByTestId('problem-screen')).toBeVisible();
  await expect(page.getByTestId('state-version')).toHaveText(versionAfterCommit);
  await expect(page.getByTestId('chunk-1')).toBeVisible();
  await expect(page.getByTestId('chunk-2')).toHaveCount(0);
  await expect(page.getByTestId('completed-step-1')).toContainText('40 students');

  await answerStep(page, 'PART_IN_PERCENTAGE');
  await continueWhenReady(page);
  await expect(page.getByTestId('chunk-2')).toBeVisible();

  await page.reload();
  await page.getByTestId('resume-session').click();
  await expect(page.getByTestId('chunk-2')).toBeVisible();
  await expect(page.getByTestId('completed-step-2')).toContainText('30%');
});
