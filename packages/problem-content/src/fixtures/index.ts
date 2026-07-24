import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseFixture, type ProblemFixture } from '../schema.js';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures');

/**
 * Load and validate every canonical fixture file (EX-01..EX-04).
 * Throws before any import if a fixture is invalid (J-11 fail-before-insert).
 */
export function loadCanonicalFixtures(): ProblemFixture[] {
  const files = readdirSync(fixturesDir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  return files.map((file) => {
    const raw = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8')) as unknown;
    try {
      return parseFixture(raw);
    } catch (err) {
      throw new Error(`Fixture ${file} failed validation: ${(err as Error).message}`);
    }
  });
}

export { fixturesDir };
