import { expect, test } from '@playwright/test';

// SCN-01: register → dashboard → logout → protected view no longer available.
test('register, reach dashboard, logout returns to auth', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('auth-view')).toBeVisible();

  await page.getByTestId('toggle-mode').click(); // switch to register
  const email = `scn01-${Date.now()}@example.com`;
  await page.getByTestId('name').fill('SCN One');
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill('Passw0rd!123');
  await page.getByTestId('submit-auth').click();

  await expect(page.getByTestId('dashboard')).toBeVisible();

  await page.getByTestId('logout').click();
  await expect(page.getByTestId('auth-view')).toBeVisible();

  // After logout, a reload must not restore an authenticated view.
  await page.reload();
  await expect(page.getByTestId('auth-view')).toBeVisible();
});
