import { defineConfig } from 'vitest/config';

// Two projects:
//  - "unit": fast, pure, no external services (engine, config, serializers, contracts).
//  - "integration": real PostgreSQL required via DATABASE_URL (transaction/idempotency/persistence).
// Browser E2E runs under Playwright, not Vitest.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          globals: true,
          environment: 'node',
          include: ['packages/**/src/**/*.{test,spec}.ts', 'apps/api/src/**/*.{test,spec}.ts'],
          exclude: ['**/node_modules/**', '**/dist/**'],
        },
      },
      {
        test: {
          name: 'integration',
          globals: true,
          environment: 'node',
          include: ['tests/integration/**/*.test.ts', 'tests/invariants/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**'],
          // Integration tests share a real database; run serially to keep assertions deterministic.
          fileParallelism: false,
          hookTimeout: 120_000,
          testTimeout: 60_000,
          globalSetup: ['tests/integration/global-setup.ts'],
          setupFiles: ['tests/integration/setup-env.ts'],
        },
      },
    ],
  },
});
