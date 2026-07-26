import { defineConfig, devices } from '@playwright/test';

/**
 * E2E modes:
 *
 * Local full E2E (default):
 *   npm run test:e2e
 *
 * Deployed, non-destructive smoke:
 *   E2E_BASE_URL=https://motimathtutorv2.onrender.com npm run test:e2e
 *
 * Deployed mode:
 * - does not start a local server;
 * - does not run global setup, DB reset, seed, or migrations;
 * - runs only *.deploy.spec.ts files.
 */
const LOCAL_PORT = 8181;
const LOCAL_BASE_URL = `http://localhost:${LOCAL_PORT}`;

const deployedBaseUrl = process.env.E2E_BASE_URL?.trim().replace(/\/+$/, '');
const isDeployedRun = Boolean(deployedBaseUrl);
const baseURL = deployedBaseUrl ?? LOCAL_BASE_URL;

const localServerEnv = {
  NODE_ENV: 'production',
  PORT: String(LOCAL_PORT),
  DATABASE_URL:
    process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5439/reasoning_tutor',
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? 'e2e-test-secret-please-change-32chars',
  BETTER_AUTH_URL: LOCAL_BASE_URL,
  TRUSTED_ORIGINS: LOCAL_BASE_URL,
  TRUSTED_PROXIES: '127.0.0.1',
  LOG_LEVEL: 'warn',
  ENGINE_VERSION: '1.0.0',
  CONTENT_SEED_MODE: 'off',
};

export default defineConfig({
  testDir: './tests/e2e',

  testMatch: isDeployedRun ? '**/*.deploy.spec.ts' : '**/*.spec.ts',
  testIgnore: isDeployedRun ? undefined : '**/*.deploy.spec.ts',

  fullyParallel: false,
  workers: 1,
  timeout: isDeployedRun ? 180_000 : 30_000,
  expect: {
    timeout: isDeployedRun ? 15_000 : 5_000,
  },
  retries: process.env.CI || isDeployedRun ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',

  // Never execute local database setup against the deployed environment.
  globalSetup: isDeployedRun ? undefined : './tests/e2e/global-setup.ts',

  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: isDeployedRun
    ? undefined
    : {
        command: 'node --import tsx apps/api/src/server.ts',
        url: `http://127.0.0.1:${LOCAL_PORT}/health`,
        timeout: 60_000,
        reuseExistingServer: !process.env.CI,
        env: localServerEnv,
      },
});
