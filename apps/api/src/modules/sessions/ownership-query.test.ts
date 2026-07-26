import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('session ownership query invariants', () => {
  it('scopes the resume read, FOR UPDATE lock, and state updates by authenticated subject', () => {
    const source = readFileSync(new URL('./service.ts', import.meta.url), 'utf8');
    const getSessionSource = source.slice(
      source.indexOf('export async function getSession'),
      source.indexOf('export async function submitAction'),
    );
    const submitActionSource = source.slice(source.indexOf('export async function submitAction'));
    const ownedSessionPredicate =
      /eq\(learningSessions\.id, sessionId\)[\s\S]*eq\(learningSessions\.analyticsSubjectId, profile\.analyticsSubjectId\)/;

    expect(getSessionSource).toMatch(ownedSessionPredicate);
    expect(submitActionSource).toMatch(ownedSessionPredicate);
    expect(submitActionSource).toContain(".for('update')");
    expect(
      submitActionSource.match(
        /eq\(learningSessions\.analyticsSubjectId, profile\.analyticsSubjectId\)/g,
      ),
    ).toHaveLength(3);
  });
});
