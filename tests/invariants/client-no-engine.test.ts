import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * AC-050 / PB-039: the web client must not embed semantic engine decisions.
 * Controls are gated by server `allowed_actions` only.
 */
describe('client has no semantic validation source of truth (AC-050)', () => {
  it('ProblemView gates controls on allowed_actions and has no misconception engine', () => {
    const source = readFileSync(
      join(root, 'apps/web/src/features/problem/ProblemView.tsx'),
      'utf8',
    );
    expect(source).toContain('allowed_actions.includes');
    expect(source).not.toMatch(
      /PREMATURE_QUANTIFICATION|WHOLE_PART_CONFUSION|classifyMisconception/,
    );
    expect(source).not.toMatch(/from ['"]@app\/engine['"]/);
  });

  it('App submit path does not import the reasoning engine', () => {
    const source = readFileSync(join(root, 'apps/web/src/app/App.tsx'), 'utf8');
    expect(source).not.toMatch(/from ['"]@app\/engine['"]/);
    expect(source).toContain('newClientActionId');
    expect(source).toContain('createPendingAction');
  });
});
