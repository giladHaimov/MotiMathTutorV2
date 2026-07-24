import { expect, test, type Page } from '@playwright/test';

async function register(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('auth-view')).toBeVisible();
  await page.getByTestId('toggle-mode').click();
  await page.getByTestId('name').fill('SCN Two');
  await page
    .getByTestId('email')
    .fill(`scn02-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`);
  await page.getByTestId('password').fill('Passw0rd!123');
  await page.getByTestId('submit-auth').click();
  await expect(page.getByTestId('dashboard')).toBeVisible();
}

// SCN-02: only the first chunk is visible; then assign Whole and resume after reload.
test('start session shows only chunk 1, assign Whole, resume persists', async ({ page }) => {
  await register(page);

  await page.getByTestId('start-session').click();
  await expect(page.getByTestId('problem-screen')).toBeVisible();

  // Only chunk 0 is revealed — future chunks are not in the DOM (AC-011/012).
  await expect(page.getByTestId('chunk-0')).toBeVisible();
  await expect(page.getByTestId('chunk-1')).toHaveCount(0);
  await expect(page.getByTestId('chunk-2')).toHaveCount(0);
  await expect(page.getByTestId('state-version')).toHaveText('0');

  // Assign the revealed token into the Whole slot.
  await page.getByTestId('token-ex01-c0-whole').click();
  await page.getByTestId('assign-WHOLE').click();

  await expect(page.getByTestId('state-version')).toHaveText('1');
  await expect(page.getByTestId('slot-label-WHOLE')).toHaveText('40 students');

  // Reload (client state discarded) and resume from the server: state persists.
  await page.reload();
  await expect(page.getByTestId('dashboard')).toBeVisible();
  await page.getByTestId('resume-session').click();
  await expect(page.getByTestId('problem-screen')).toBeVisible();
  await expect(page.getByTestId('state-version')).toHaveText('1');
  await expect(page.getByTestId('slot-label-WHOLE')).toHaveText('40 students');
});
