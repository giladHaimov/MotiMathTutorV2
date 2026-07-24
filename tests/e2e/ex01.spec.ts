import { expect, test, type Page } from '@playwright/test';

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

async function assignToken(page: Page, tokenId: string, slot: string): Promise<void> {
  await page.getByTestId(`token-${tokenId}`).click();
  await page.getByTestId(`assign-${slot}`).click();
}

async function continueWhenReady(page: Page): Promise<void> {
  await expect(page.getByTestId('continue')).toBeEnabled();
  await page.getByTestId('continue').click();
}

// SCN-03: EX-01 valid Whole → percentage → Unknown → answer 12
test('SCN-03 EX-01 happy path completes with answer 12', async ({ page }) => {
  await register(page, 'SCN Three');
  await startProblem(page);

  await assignToken(page, 'ex01-c0-whole', 'WHOLE');
  await expect(page.getByTestId('slot-label-WHOLE')).toHaveText('40 students');
  await continueWhenReady(page);
  await expect(page.getByTestId('chunk-1')).toBeVisible();
  await expect(page.getByTestId('chunk-2')).toHaveCount(0);

  await assignToken(page, 'ex01-c1-percent', 'PART_IN_PERCENTAGE');
  await continueWhenReady(page);
  await expect(page.getByTestId('chunk-2')).toBeVisible();

  await assignToken(page, 'ex01-c2-unknown', 'UNKNOWN');
  await expect(page.getByTestId('final-answer-input')).toBeVisible();
  await page.getByTestId('final-answer-input').fill('12');
  await page.getByTestId('submit-answer').click();

  await expect(page.getByTestId('completed')).toBeVisible();
  await expect(page.getByTestId('status')).toHaveText('COMPLETED');
  await expect(page.getByTestId('result')).toBeVisible();
});

// SCN-04: place 30% in Whole → blocked → delete → recover → finish
test('SCN-04 EX-01 wrong Whole placement blocked then delete recover finish', async ({ page }) => {
  await register(page, 'SCN Four');
  await startProblem(page);

  await assignToken(page, 'ex01-c0-whole', 'WHOLE');
  await continueWhenReady(page);
  await expect(page.getByTestId('chunk-1')).toBeVisible();

  // Free WHOLE, then attempt the invalid 30% → WHOLE placement.
  await page.getByTestId('delete-WHOLE').click();
  await expect(page.getByTestId('slot-label-WHOLE')).toHaveCount(0);

  await assignToken(page, 'ex01-c1-percent', 'WHOLE');
  await expect(page.getByTestId('message')).toBeVisible();
  await expect(page.getByTestId('slot-label-WHOLE')).toHaveCount(0);
  await expect(page.getByTestId('chunk-2')).toHaveCount(0);

  // Recover: place Whole correctly, then finish the journey.
  await assignToken(page, 'ex01-c0-whole', 'WHOLE');
  await assignToken(page, 'ex01-c1-percent', 'PART_IN_PERCENTAGE');
  await continueWhenReady(page);
  await expect(page.getByTestId('chunk-2')).toBeVisible();

  await assignToken(page, 'ex01-c2-unknown', 'UNKNOWN');
  await page.getByTestId('final-answer-input').fill('12');
  await page.getByTestId('submit-answer').click();
  await expect(page.getByTestId('completed')).toBeVisible();
  await expect(page.getByTestId('status')).toHaveText('COMPLETED');
});

test('refresh during each EX-01 stage resumes authoritative state', async ({ page }) => {
  await register(page, 'SCN Resume');
  await startProblem(page);

  await assignToken(page, 'ex01-c0-whole', 'WHOLE');
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
  await expect(page.getByTestId('slot-label-WHOLE')).toHaveText('40 students');

  await assignToken(page, 'ex01-c1-percent', 'PART_IN_PERCENTAGE');
  await continueWhenReady(page);
  await expect(page.getByTestId('chunk-2')).toBeVisible();

  await page.reload();
  await page.getByTestId('resume-session').click();
  await expect(page.getByTestId('chunk-2')).toBeVisible();
  await expect(page.getByTestId('slot-label-PART_IN_PERCENTAGE')).toHaveText('30%');
});
