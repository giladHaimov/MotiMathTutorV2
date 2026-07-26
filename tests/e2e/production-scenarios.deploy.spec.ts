import { test } from '@playwright/test';
import { scenarioCatalog } from '../scenarios/catalog.js';
import { DeployedScenarioDriver } from './deployed-scenario-driver.js';

if (!process.env.E2E_BASE_URL) {
  throw new Error(
    'production-scenarios.deploy.spec.ts requires E2E_BASE_URL; deployed scenarios never run locally',
  );
}

/**
 * Independence proof (required before dropping describe serial fail-skip):
 *
 * 1. Users: every scenario starts with register(); DeployedScenarioDriver mints
 *    `deploy-{scenarioId}-{ref}-{Date.now()}-{uuid}@example.test` + random password.
 * 2. Sessions: created only via POST /api/sessions for that cookie jar; IDs are
 *    server UUIDs, never shared literals in the catalog.
 * 3. Action ids: crypto.randomUUID() (or a map local to one driver instance).
 * 4. Ordering: no scenario reads another scenario’s user/session/output; a fresh
 *    subject always begins at EX-01. Shared problem content is read-only.
 * 5. Isolation boundary: each test constructs a new DeployedScenarioDriver with
 *    private users/sessions/actionIds maps; Playwright gives each test its own page.
 *
 * Therefore describe `mode: 'serial'` (fail → skip siblings) is unnecessary for
 * correctness. workers=1 + fullyParallel=false still run tests one-at-a-time,
 * which avoids Better Auth per-IP sign-up rate-limit collisions without coupling
 * pass/fail reporting.
 */
const deployedScenarioIds = [
  'JS-05', // full four-problem journey and next-problem transitions
  'JS-11', // premature/incorrect final-answer rejection followed by recovery
  'JS-13', // optimistic concurrency and authoritative conflict state
  'JS-03', // two-user ownership and isolation
  'JS-24', // authoritative refreshes, one UI assign, one UI final answer, dashboard clearance
] as const;

const deployedScenarios = deployedScenarioIds.map((id) => {
  const scenario = scenarioCatalog.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`Missing shared scenario ${id}`);
  return scenario;
});

test.describe('deployed shared learner scenarios', () => {
  for (const scenario of deployedScenarios) {
    test(`${scenario.id} ${scenario.title}`, async ({ page }) => {
      // Multi-problem remote journeys need headroom beyond the default 60s.
      test.setTimeout(scenario.id === 'JS-05' ? 180_000 : 120_000);
      test.info().annotations.push({
        type: 'shared-scenario',
        description: `${scenario.id}: ${scenario.refs.join(', ')}`,
      });
      await new DeployedScenarioDriver(page, test.step).run(scenario);
    });
  }
});
