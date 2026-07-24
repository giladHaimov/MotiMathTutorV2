# Slice 06 — Release Hardening and Full Acceptance

## Purpose

Convert the completed product into a reproducible, reviewable release candidate.

## Product scope

PB-027–PB-050 and all remaining requirements.

## Acceptance scope

AC-040–AC-060 and all previously defined criteria.

## In scope

- Complete 15-scenario acceptance suite.
- Clean-clone verification.
- Clean PostgreSQL migrations.
- Idempotent canonical seed import.
- Docker build/start/restart acceptance.
- Logging/privacy scan.
- Secrets scan.
- Production artifact review.
- Required indexes/constraints review.
- No TODO/mock/stub/fake/disabled-test scan.
- Documentation of environment variables and run commands.
- Final Codex acceptance preparation.
- Explicit human release checklist.

## Explicit non-goals

- New product features.
- Refactoring without acceptance value.
- Analytics dashboard.
- Performance infrastructure beyond basic bounded load/smoke evidence.

## Primary tables

All tables are exercised through full flows. No new table is expected.

## Required tests

- SCN-01 through SCN-15.
- All AC-001 through AC-060.
- Container restart persistence.
- No full-problem leak.
- Cross-user authorization.
- Duplicate/stale/concurrent actions.
- Transaction failure atomicity.
- Version pinning.
- Operational-log secret scan.
- Clean environment reproduction.

## Definition of done

- `npm run verify` passes from clean clone.
- Docker acceptance passes.
- Codex Full Acceptance Audit returns PASS or all blocking findings are fixed and rechecked.
- Human Gate C checklist passes.
- All 50 Product requirements remain mapped.
