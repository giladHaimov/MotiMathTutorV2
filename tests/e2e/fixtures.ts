import { createHash } from 'node:crypto';
import { test as base, expect } from '@playwright/test';

/**
 * Playwright fixture that gives each test a unique client IP via
 * `X-Forwarded-For`. Production keeps Better Auth's default sign-up/sign-in
 * rate limits; E2E isolation must not weaken those limits.
 */
export const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const seed = [
      testInfo.workerIndex,
      testInfo.parallelIndex,
      testInfo.retry,
      ...testInfo.titlePath,
    ].join('|');
    const digest = createHash('sha256').update(seed).digest();
    // Documentation TEST-NET-2 range — unique per test, never a production client.
    const ip = `198.51.${digest[0]}.${(digest[1]! % 254) + 1}`;
    await page.setExtraHTTPHeaders({ 'x-forwarded-for': ip });
    await use(page);
  },
});

export { expect };
