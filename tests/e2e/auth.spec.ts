import { expect, test } from './fixtures.js';

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

// Guard: wrong credentials are rejected and Better Auth's production rate
// limit remains active inside one isolated browser context.
test('login with a wrong password is rejected', async ({ page, clientIp }) => {
  const email = `scn01-bad-${Date.now()}@example.com`;
  const password = 'Passw0rd!123';
  const authRequestIps: string[] = [];

  page.on('request', (request) => {
    if (request.url().includes('/api/auth/')) {
      authRequestIps.push(request.headers()['x-forwarded-for'] ?? '');
    }
  });

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

  const statuses = await page.evaluate(
    async ({ email }) => {
      const result: number[] = [];
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const response = await fetch('/api/auth/sign-in/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password: 'WrongPassword!999' }),
        });
        result.push(response.status);
      }
      return result;
    },
    { email },
  );

  expect(statuses).toEqual([401, 401, 429, 429]);
  expect(authRequestIps.length).toBeGreaterThan(0);
  expect(new Set(authRequestIps)).toEqual(new Set([clientIp]));
});
