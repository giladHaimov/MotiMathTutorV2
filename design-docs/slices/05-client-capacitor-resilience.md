# Slice 05 — Complete Client, Capacitor, and Network Resilience

## Purpose

Deliver the usable responsive client and mobile packaging without moving reasoning logic to the client.

## Product scope

PB-015–PB-021, PB-039–PB-043, PB-045–PB-050.

## Acceptance scope

AC-045–AC-051.

## User journey

```text
login
→ dashboard
→ start/resume
→ complete canonical problem
→ temporary response loss
→ retry safely
→ app restart
→ resume authoritative server state
```

## In scope

- Complete responsive UI states:
  - login/register;
  - dashboard;
  - ProblemScreen;
  - completion.
- Loading, empty, validation, conflict, offline, retry, and fatal-error UX.
- Stable client action IDs across retry.
- Reconciliation after stale-version response.
- Capacitor Android/iOS projects.
- Secure approved mobile auth-token/session handling.
- App lifecycle resume.
- Accessibility basics and touch ergonomics.

## Explicit non-goals

- Offline reasoning.
- Local durable source of truth.
- Push notifications.
- App-store submission automation.

## Primary tables

No new product table. Uses existing auth/session/action/event tables through API only.

## Required tests

- Browser E2E for all major UI states.
- Retry with same action ID.
- Stale response reconciliation.
- Refresh/restart resume.
- No semantic-validation decisions in client tests/source.
- Android build/start smoke.
- iOS build/start smoke where environment permits.
- Explicit human device/simulator scenario SCN-15.

## Definition of done

- Same web build runs in browser and Capacitor.
- No hidden content in client bundle/API.
- Human mobile smoke passes or a documented Gate A-approved exception exists.
- `npm run verify` passes.
