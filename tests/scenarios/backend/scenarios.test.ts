import { afterAll, describe, it } from 'vitest';
import { closePool } from '../../../apps/api/src/db/index.js';
import { scenarioCatalog } from '../catalog.js';
import { ScenarioRunner } from './runner.js';

describe('long-running full user journeys (real API + PostgreSQL)', () => {
  for (const scenario of scenarioCatalog) {
    it(`${scenario.id} ${scenario.title}`, async () => {
      await new ScenarioRunner().run(scenario);
    }, 120_000);
  }
});

afterAll(async () => {
  await closePool();
});
