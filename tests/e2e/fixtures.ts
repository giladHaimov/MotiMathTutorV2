import { test as base, expect } from '@playwright/test';

const TESTS_PER_WORKER = 15;
let testContextIndex = 0;

export function clientIpForTest(workerIndex: number, contextIndex: number): string {
  const host = workerIndex * TESTS_PER_WORKER + contextIndex + 1;
  if (host > 254) {
    throw new Error(
      `E2E client IP pool exhausted at worker ${workerIndex}, context ${contextIndex}`,
    );
  }
  return `198.51.100.${host}`;
}

/**
 * Playwright fixture that gives each test a unique client IP via
 * `X-Forwarded-For`. Production keeps Better Auth's default sign-up/sign-in
 * rate limits; E2E isolation must not weaken those limits.
 */
export const test = base.extend<{ clientIp: string }>({
  // eslint-disable-next-line no-empty-pattern
  clientIp: async ({}, use, testInfo) => {
    const ip = clientIpForTest(testInfo.workerIndex, testContextIndex);
    testContextIndex += 1;
    await use(ip);
  },
  // Supplying this as a context option applies it before Playwright creates the
  // page and keeps it on navigations, fetches, and context.request calls.
  extraHTTPHeaders: async ({ clientIp }, use) => {
    await use({ 'x-forwarded-for': clientIp });
  },
});

export { expect };
