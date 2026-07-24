import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { makeApp, registerUser, type TestUser } from '../helpers/app.js';
import { closePool, db } from '../../apps/api/src/db/index.js';
import { learningSessions, problems } from '../../apps/api/src/db/schema/product.js';
import { importCanonicalContent } from '../../apps/api/src/modules/content/importer.js';
import type { PublicSession } from '@app/contracts';

let app: FastifyInstance;
let user: TestUser;

beforeAll(async () => {
  app = await makeApp();
  user = await registerUser(app);
});
afterAll(async () => {
  await app.close();
  await closePool();
});

describe('content import and disclosure (J-11)', () => {
  it('imports the four canonical fixtures and keeps them immutable (AC-008/009)', async () => {
    const all = await db.select().from(problems);
    for (const key of ['EX-01', 'EX-02', 'EX-03', 'EX-04']) {
      expect(all.some((p) => p.problemKey === key)).toBe(true);
    }
    // Re-import is a no-op: existing versions are left untouched (immutable).
    const summary = await importCanonicalContent(db);
    expect(summary.problems).toBe(0);
    expect(summary.skippedImmutable).toBeGreaterThanOrEqual(4);
  });

  it('pins engine + content versions when a session starts (AC-010)', async () => {
    const started = (
      await app.inject({ method: 'POST', url: '/api/sessions', headers: { cookie: user.cookie } })
    ).json() as PublicSession;
    expect(started.engine_version).toBe('1.0.0');

    const [sessionRow] = await db
      .select({
        problemId: learningSessions.problemId,
        contentVersion: learningSessions.contentVersion,
      })
      .from(learningSessions)
      .where(eq(learningSessions.id, started.session_id));
    const [problem] = await db
      .select({ version: problems.version, problemKey: problems.problemKey })
      .from(problems)
      .where(eq(problems.id, sessionRow!.problemId));

    // content_version must be the selected problem version (not programs.version).
    expect(started.content_version).toBe(problem!.version);
    expect(sessionRow!.contentVersion).toBe(problem!.version);
    expect(problem!.problemKey).toBe('EX-01');
    expect(problem!.version).toBe(1);
  });

  it('never exposes raw full problem text through the public API (AC-012, PB-004)', async () => {
    const started = (
      await app.inject({ method: 'POST', url: '/api/sessions', headers: { cookie: user.cookie } })
    ).json() as PublicSession;

    // The server-only full_text exists in the DB...
    const [row] = await db
      .select({ fullText: problems.fullText })
      .from(problems)
      .where(eq(problems.problemKey, 'EX-01'));
    expect(row!.fullText).toContain('How many students');

    // ...but the public session response must not contain the hidden question chunk.
    const res = await app.inject({
      method: 'GET',
      url: `/api/sessions/${started.session_id}`,
      headers: { cookie: user.cookie },
    });
    expect(res.body).not.toContain('How many students');
    expect(res.body).not.toContain('Thirty percent');
  });
});
