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

async function submitPrematureAnswer(page: Page, value: string): Promise<void> {
  // Final-answer controls are hidden until the server allows them (AC-050).
  // Premature quantification is still a real student action against the API.
  await page.evaluate(async (answer) => {
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
        action_type: 'SUBMIT_FINAL_ANSWER',
        payload: { value: answer },
      }),
    });
  }, value);
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

async function completeEx04(page: Page): Promise<void> {
  await startProblem(page);
  await assignToken(page, 'ex04-c0-whole', 'WHOLE');
  await continueWhenReady(page);
  await assignToken(page, 'ex04-c1-percent', 'PART_IN_PERCENTAGE');
  await continueWhenReady(page);
  await assignToken(page, 'ex04-c2-unknown', 'UNKNOWN');
  await page.getByTestId('final-answer-input').fill('12');
  await page.getByTestId('submit-answer').click();
  await expect(page.getByTestId('completed')).toBeVisible();
  await page.getByTestId('back-dashboard').click();
}

// SCN-05: EX-02 attempt numeric after first chunk → blocked/acknowledge → finish 10
test('SCN-05 EX-02 premature answer blocked then acknowledge finish 10', async ({ page }) => {
  await register(page, 'SCN Five');
  await completeEx01(page);
  await startProblem(page);
  await expect(page.getByTestId('chunk-0')).toContainText('ratio 2:3');
  await expect(page.getByTestId('chunk-1')).toHaveCount(0);

  await submitPrematureAnswer(page, '10');
  await expect(page.getByTestId('acknowledge')).toBeVisible();
  await expect(page.getByTestId('message')).toBeVisible();
  await page.getByTestId('acknowledge').click();
  await expect(page.getByTestId('acknowledge')).toHaveCount(0);

  await assignToken(page, 'ex02-c0-ratio', 'RATIO');
  await continueWhenReady(page);
  await expect(page.getByTestId('chunk-1')).toBeVisible();
  await assignToken(page, 'ex02-c1-blue', 'PART_IN_NUMBER');
  await continueWhenReady(page);
  await expect(page.getByTestId('chunk-2')).toBeVisible();
  await assignToken(page, 'ex02-c2-unknown', 'UNKNOWN');
  await page.getByTestId('final-answer-input').fill('10');
  await page.getByTestId('submit-answer').click();
  await expect(page.getByTestId('completed')).toBeVisible();
  await expect(page.getByTestId('status')).toHaveText('COMPLETED');
});

// SCN-06: EX-03 calculate before Whole → blocked → distinguish remaining → finish 20
test('SCN-06 EX-03 premature calc then complement reject finish 20', async ({ page }) => {
  await register(page, 'SCN Six');
  await completeEx01(page);
  await completeEx02(page);
  await completeEx04(page);
  await startProblem(page);
  await expect(page.getByTestId('chunk-0')).toContainText('three fifths');

  await submitPrematureAnswer(page, '30');
  await expect(page.getByTestId('acknowledge')).toBeVisible();
  await page.getByTestId('acknowledge').click();

  await assignToken(page, 'ex03-c0-fraction', 'FRACTION');
  await continueWhenReady(page);
  await expect(page.getByTestId('chunk-1')).toBeVisible();
  await assignToken(page, 'ex03-c1-whole', 'WHOLE');
  await continueWhenReady(page);
  await expect(page.getByTestId('chunk-2')).toBeVisible();

  // Treat 3/5 as remaining: free the fraction token, then place it in UNKNOWN.
  await page.getByTestId('delete-FRACTION').click();
  await assignToken(page, 'ex03-c0-fraction', 'UNKNOWN');
  await expect(page.getByTestId('message')).toBeVisible();
  await expect(page.getByTestId('slot-label-UNKNOWN')).toHaveCount(0);

  await assignToken(page, 'ex03-c0-fraction', 'FRACTION');
  await assignToken(page, 'ex03-c2-unknown', 'UNKNOWN');
  await page.getByTestId('final-answer-input').fill('20');
  await page.getByTestId('submit-answer').click();
  await expect(page.getByTestId('completed')).toBeVisible();
  await expect(page.getByTestId('status')).toHaveText('COMPLETED');
});
