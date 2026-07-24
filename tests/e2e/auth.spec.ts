import { expect, test } from '@playwright/test';

// SCN-01: register → logout → LOG IN (real credentials) → dashboard → logout.
test('register, logout, log back in with real credentials, logout again', async ({ page }) => {
  const email = `scn01-${Date.now()}@example.com`;
  const password = 'Passw0rd!123';

  await page.goto('/');
  await expect(page.getByTestId('auth-view')).toBeVisible();

  // --- Register ---
  await page.getByTestId('toggle-mode').click(); // switch to register
  await page.getByTestId('name').fill('SCN One');
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill(password);
  await page.getByTestId('submit-auth').click();
  await expect(page.getByTestId('dashboard')).toBeVisible();

  // --- Logout ---
  await page.getByTestId('logout').click();
  await expect(page.getByTestId('auth-view')).toBeVisible();

  // --- Log back in with the SAME credentials (real login, default login mode) ---
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill(password);
  await page.getByTestId('submit-auth').click();
  await expect(page.getByTestId('dashboard')).toBeVisible();

  // --- Logout again; a reload must not restore an authenticated view ---
  await page.getByTestId('logout').click();
  await expect(page.getByTestId('auth-view')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('auth-view')).toBeVisible();
});

// Guard: a wrong password must be rejected (real server-side auth).
test('login with a wrong password is rejected', async ({ page }) => {
  const email = `scn01-bad-${Date.now()}@example.com`;
  const password = 'Passw0rd!123';

  await page.goto('/');
  await page.getByTestId('toggle-mode').click();
  await page.getByTestId('name').fill('Bad Login');
  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill(password);
  await page.getByTestId('submit-auth').click();
  await expect(page.getByTestId('dashboard')).toBeVisible();

  await page.getByTestId('logout').click();
  await expect(page.getByTestId('auth-view')).toBeVisible();

  await page.getByTestId('email').fill(email);
  await page.getByTestId('password').fill('WrongPassword!999');
  await page.getByTestId('submit-auth').click();
  await expect(page.getByTestId('auth-error')).toBeVisible();
  await expect(page.getByTestId('dashboard')).toHaveCount(0);
});
