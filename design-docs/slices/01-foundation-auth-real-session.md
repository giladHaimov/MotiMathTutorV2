# Slice 01 — Trust Foundation: Auth, PostgreSQL, Container, Thin Session Flow

## Purpose

Prove that the repository is real and trustworthy before broader engine work.

## Product scope

PB-002, PB-004, PB-015–PB-027, PB-029–PB-035, PB-039, PB-042–PB-044.

## Acceptance scope

AC-001–AC-023, AC-040–AC-044, AC-052–AC-055.

## User journey

```text
register
→ login
→ dashboard
→ start EX-01 session
→ receive only chunk 1
→ submit one valid Whole assignment
→ attempt/event/state persist atomically
→ restart backend
→ resume exact state
```

## In scope

- npm-workspaces repository skeleton.
- React/Vite app shell.
- Fastify API.
- Better Auth email/password.
- `user_profiles`.
- Full initial database schema and migrations.
- Config validation.
- Structured operational logs.
- `/health`.
- Fixture schema and EX-01–EX-04 seed/import skeleton.
- Session start/resume.
- One minimal valid EX-01 action through the real pure engine boundary.
- `client_action_id` idempotency.
- `expected_state_version` conflict handling.
- Ownership authorization.
- Production Dockerfile and Docker Compose.
- CI and initial invariant tests.

## Explicit non-goals

- Complete semantic engine.
- Ratio/fraction behavior.
- Misconception/rollback implementation beyond schema.
- Polished UI.
- Native-specific mobile behavior.

## Primary tables

All tables are migrated. Runtime use in this Slice:

- auth tables;
- `user_profiles`;
- `programs`;
- `problems`;
- `chunks`;
- `learning_sessions`;
- `stage_attempts`;
- `learning_events`.

## Required tests

- real register/login/logout;
- anonymous protected-route denial;
- cross-user session denial;
- clean migrations;
- fixture validation/import;
- start session exposes only first chunk;
- accepted thin action writes attempt/event/session atomically;
- duplicate action applies once;
- stale version rejected;
- transaction rollback test;
- backend restart/resume;
- clean Docker start and health.

## Human Gate B check

- Register/login manually.
- Inspect real PostgreSQL rows.
- Verify no hidden chunks in network response.
- Restart app and resume.
- Attempt copied session ID as another user.
- Inspect safe lifecycle logs.

## Definition of done

- `npm run verify` passes.
- Docker acceptance passes.
- No fake auth/DB/in-memory path.
- Codex deep foundation review returns no blocking issue.
