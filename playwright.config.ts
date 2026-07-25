import { defineConfig, devices } from '@playwright/test';

/**
 * Browser E2E against the REAL API + PostgreSQL (no mocks). The Fastify server
 * serves the built SPA and the API on one origin, matching production.
 */
const PORT = 8181;
const BASE_URL = `http://localhost:${PORT}`;

const env = {
  NODE_ENV: 'production',
  PORT: String(PORT),
  DATABASE_URL:
    process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5439/reasoning_tutor',
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? 'e2e-test-secret-please-change-32chars',
  BETTER_AUTH_URL: BASE_URL,
  TRUSTED_ORIGINS: BASE_URL,
  // Test-only: honor unique X-Forwarded-For isolation (production default remains empty).
  TRUSTED_PROXIES: '127.0.0.1',
  LOG_LEVEL: 'warn',
  ENGINE_VERSION: '1.0.0',
};

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'line' : 'list',
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node --import tsx apps/api/src/server.ts',
    url: `http://127.0.0.1:${PORT}/health`,
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
    env,
  },
});
