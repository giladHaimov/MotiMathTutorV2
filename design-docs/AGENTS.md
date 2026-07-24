# AGENTS.md

## Authority

Read before coding:

1. `PRODUCT_BOOK.md`
2. `PRODUCT.md`
3. `ARCHITECTURE.md`
4. `ACCEPTANCE.md`
5. the assigned `slices/*.md`

If documents conflict, stop and report the conflict.

## Scope

- Implement exactly one assigned Slice.
- Do not implement later-Slice work.
- Do not edit authoritative design documents.
- Do not expand product scope.
- Use the frozen stack and repository layout.
- Prefer the simplest correct implementation.

## Non-negotiable behavior

- Real Better Auth authentication.
- Backend-enforced ownership/authorization.
- Real PostgreSQL; no SQLite or in-memory production fallback.
- No reasoning logic in web/Capacitor clients.
- Never return future hidden chunks or raw full problem definitions.
- Duplicate `client_action_id` affects state once.
- Stale state versions change nothing.
- Accepted action, state update, attempt, events, and rollback are transactional.
- Explicit deletion is required for conflicts.
- No silent auto-correction.
- Existing sessions remain pinned to engine/content versions.

## Code rules

- TypeScript strict mode.
- Keep domain engine pure and deterministic.
- Thin routes; business logic in modules/services.
- Database access through the approved DB layer.
- Validate all external inputs.
- Use bounded external-call timeouts/retries when relevant.
- New dependencies require concise justification.
- No new service, cache, queue, framework, ORM, or auth path without approval.
- No secrets or passwords in code, logs, fixtures, or ordinary tables.
- Configuration is accessed only through the validated config module.

## Logging

For important state-changing actions, emit:

- start;
- success;
- failure when applicable.

Include safe request/action/session IDs and duration. Never log auth tokens, password/hash, email in learning-flow logs, or hidden content.

## Tests

During development run:

```bash
npm run check
```

Before completion run:

```bash
npm run verify
```

Required evidence uses real auth, API, and PostgreSQL.

Do not:

- mock the application API/DB in release E2E;
- skip required tests;
- use `.only`;
- weaken assertions;
- change verification to obtain PASS;
- hide failures as warnings.

Changes to CI, verification scripts, invariant tests, Playwright/Vitest configuration, or Docker verification must be reported explicitly.

## Repair limit

Make at most two serious repairs for the same root cause.

Then stop and report:

- failing command;
- exact error;
- attempted repairs;
- suspected cause;
- decision needed.

Never weaken tests or architecture to escape a failure.

## Completion report

Report:

1. Slice and PB/AC IDs implemented.
2. Files changed.
3. Tests added/changed.
4. Commands run and results.
5. DB migrations.
6. Dependencies added and why.
7. Assumptions/deviations.
8. Protected verification files changed.
9. Remaining risks.
10. Commit hash.

Do not declare the whole product release-ready.
