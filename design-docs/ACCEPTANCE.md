# ACCEPTANCE.md

## 1. Purpose

This document defines the required evidence for product acceptance. A passing build requires:

- 100% of in-scope Must requirements;
- no blocking Codex findings;
- real authentication, authorization, PostgreSQL, and container evidence;
- automated tests plus explicit human mobile/device testing;
- no production fake, stub, TODO, disabled required test, or hidden fallback.

---

## 2. Verification Commands

### Fast gate

```bash
npm run check
```

Expected:

- format check;
- lint;
- strict typecheck;
- unit tests.

### Full gate

```bash
npm run verify
```

Expected:

- fast gate;
- real PostgreSQL integration tests;
- migrations from empty database;
- fixture validation and seed import;
- realistic Playwright scenarios;
- production build;
- Docker/container smoke.

No release evidence may use a mocked application API or mocked database.

---

## 3. Acceptance Criteria

### Foundation, identity, and ownership

- **AC-001** Registration and login use the real selected authentication library and PostgreSQL.
- **AC-002** Logged-out access to every protected API is rejected.
- **AC-003** Logout prevents subsequent protected access.
- **AC-004** A pseudonymous `user_profiles` row exists without duplicating email into learning records.
- **AC-005** Student A cannot read or modify Student B’s session.
- **AC-006** Student A cannot read Student B’s attempts/events through any public route.
- **AC-007** Missing required secret or DB configuration aborts startup.

### Content and disclosure

- **AC-008** EX-01 through EX-04 fixture files pass schema validation and import.
- **AC-009** Imported content is immutable by version.
- **AC-010** Starting a session pins engine and content versions.
- **AC-011** A new session returns only the first permitted chunk.
- **AC-012** No public API response contains future hidden chunks or full problem text.
- **AC-013** Existing sessions remain on pinned content after newer content is activated.
- **AC-014** Next-problem selection is deterministic and excludes completed/inactive content according to the approved rule.

### Actions and state integrity

- **AC-015** Every action requires the five mandatory action fields.
- **AC-016** Invalid action payloads are rejected without state change.
- **AC-017** Duplicate `client_action_id` changes state once and returns the stored result.
- **AC-018** Stale `expected_state_version` is rejected and returns authoritative state.
- **AC-019** Two concurrent actions cannot both advance the same state version.
- **AC-020** Accepted state update, attempt, learning events, and rollback record commit atomically.
- **AC-021** Forced transaction failure leaves no partial session/event/attempt state.
- **AC-022** Backend restart preserves exact session state.
- **AC-023** Completed sessions reject further state-changing actions.

### Semantic engine

- **AC-024** Valid commitment reveals the next chunk only when its gate is complete.
- **AC-025** Invalid typed-slot placement blocks progression.
- **AC-026** Conflicting assignment remains blocked until explicit deletion.
- **AC-027** No invalid assignment is silently corrected.
- **AC-028** Premature numeric/semantic commitment is blocked.
- **AC-029** Insufficient-information acknowledgment is required where defined.
- **AC-030** Misconception class is deterministic for the same state/action.
- **AC-031** Repeated equivalent error triggers the configured deterministic rollback.
- **AC-032** Duplicate action cannot trigger duplicate rollback.
- **AC-033** Final answer is unavailable before all required structural gates.
- **AC-034** Correct final answer completes the session.
- **AC-035** Incorrect final answer does not complete the session.

### Canonical worked examples

- **AC-036** EX-01 resolves to 12 with Whole/percentage/unknown behavior as specified.
- **AC-037** EX-02 blocks numeric answer before scale and resolves to 10.
- **AC-038** EX-03 blocks early page calculation, distinguishes complement, and resolves to 20.
- **AC-039** EX-04 requires deletion and applies deterministic repeated-error rollback.

### Logging and privacy

- **AC-040** Important action execution has start/success/error operational logs as applicable.
- **AC-041** Learning events are stored separately from operational logs.
- **AC-042** Operational logs contain no password, token, secret, password hash, or future hidden content.
- **AC-043** Learning events reference pseudonymous subject ID and required engine/content versions.
- **AC-044** Every submitted action has an attempt record and at least one appropriate learning event.

### Web, mobile, and resilience

- **AC-045** Responsive web app completes the primary learning flow.
- **AC-046** Capacitor Android project builds and starts.
- **AC-047** Capacitor iOS project builds and starts in an available simulator/build environment.
- **AC-048** Temporary response loss followed by retry does not duplicate state.
- **AC-049** App refresh/restart resumes exact authoritative server state.
- **AC-050** UI never performs semantic validation as the source of truth.
- **AC-051** Human mobile smoke verifies chunk reveal, slot assignment, deletion, retry, and resume.

### Container and release

- **AC-052** Clean Docker build succeeds without host dependencies.
- **AC-053** Empty PostgreSQL migration succeeds.
- **AC-054** Canonical seed import succeeds.
- **AC-055** `/health` remains unhealthy until required dependencies/configuration are valid.
- **AC-056** Containerized application passes API and Playwright smoke.
- **AC-057** Application-container restart preserves session state.
- **AC-058** No production TODO, mock, stub, fake auth, in-memory fallback, `.only`, or disabled required test remains.
- **AC-059** All protected verification files remain active and were not weakened.
- **AC-060** Human final smoke and Codex final audit both return release approval.

---

## 4. Realistic End-to-End Scenarios

The release suite contains the following 15 scenarios.

| Scenario | Flow | Type | Evidence |
|---|---|---|---|
| SCN-01 | Register → login → dashboard → logout → protected route rejected | Happy/sad | Automated Playwright |
| SCN-02 | Login → start EX-01 → only chunk 1 visible | Security | Automated Playwright + response assertion |
| SCN-03 | EX-01 valid Whole → percentage → Unknown → answer 12 | Happy | Automated Playwright |
| SCN-04 | EX-01 place 30% in Whole → blocked → delete → recover | Sad/recovery | Automated Playwright |
| SCN-05 | EX-02 attempt numeric answer after chunk 1 → blocked/acknowledge → finish 10 | Sad/happy | Automated Playwright |
| SCN-06 | EX-03 calculate before Whole → blocked → distinguish remaining → finish 20 | Sad/happy | Automated Playwright |
| SCN-07 | EX-04 repeat misconception → deterministic rollback | Sad | Integration + Playwright |
| SCN-08 | Submit same action twice with same ID → state advances once | Network retry | Integration |
| SCN-09 | Submit action with stale version → conflict and authoritative state | Concurrency | Integration |
| SCN-10 | Two students; copied session ID cannot cross access | Authorization | API integration + Playwright |
| SCN-11 | Start session → restart backend → resume exact workspace/reveal state | Persistence | Container integration |
| SCN-12 | Force failure during accepted transition → no partial state/event | Transaction | Integration fault injection |
| SCN-13 | Activate new content version while session active → old session remains pinned | Versioning | Integration |
| SCN-14 | Clean Docker/DB → migrate → seed → health → full web flow | Packaging | CI/container acceptance |
| SCN-15 | Android/iOS app: login → start → action → response loss/retry → resume | Mobile | Explicit human device/simulator test |

---

## 5. Auth/Authorization Acceptance Matrix

| Test | Expected |
|---|---|
| Anonymous `/health` | Allowed |
| Anonymous `/api/dashboard` | 401 |
| Student reads own session | 200 |
| Student reads another session | 404 or 403 consistently |
| Student submits action to another session | Rejected; no attempt/state change |
| Student requests raw problem definition | No public route / rejected |
| Logged-out token/session used | Rejected |
| Content import through public API | No public route |

---

## 6. Database Evidence

Required:

1. Migrate empty PostgreSQL.
2. Import EX-01–EX-04.
3. Create user and session through real application.
4. Submit action through real API.
5. Inspect corresponding `learning_sessions`, `stage_attempts`, and `learning_events` rows.
6. Restart application container.
7. Resume the same state.
8. Confirm duplicate action is not duplicated.
9. Confirm failed transaction creates no partial records.

There is no application cache in MVP. No cache-clearing ritual is required.

---

## 7. Human Acceptance Checklist

### Gate B — after Slice 1

- [ ] Register and login.
- [ ] Start a session.
- [ ] Confirm only first chunk is visible.
- [ ] Submit one valid action.
- [ ] Inspect real PostgreSQL rows.
- [ ] Restart app and resume.
- [ ] Attempt another student’s session.
- [ ] Build/start Docker.
- [ ] Confirm logs show start/success/error without secrets.

### Gate C — release

- [ ] Run SCN-15 on Android.
- [ ] Run iOS simulator/build smoke when environment permits.
- [ ] Check keyboard, safe areas, touch targets, slot assignment, deletion.
- [ ] Simulate temporary network interruption and resume.
- [ ] Walk EX-01–EX-04 manually.
- [ ] Inspect that no future chunk appears in network responses.
- [ ] Approve or block release.

---

## 8. Requirement Traceability

| Requirement | Journey | Slice | Acceptance evidence |
|---|---|---|---|
| PB-001–PB-004 | J-02/J-04 | S01/S02 | AC-011/012/024; SCN-02/03 |
| PB-005–PB-008 | J-04/J-06 | S02/S04 | AC-025–027; SCN-04 |
| PB-009–PB-010 | J-05 | S03 | AC-028/029; SCN-05/06 |
| PB-011–PB-014 | J-05/J-07 | S03/S04 | AC-030–032/039; SCN-07 |
| PB-015–PB-018 | J-04/J-09 | S01/S05 | AC-015–021; SCN-08/09/12 |
| PB-019–PB-021 | J-03/J-09/J-11 | S01/S05 | AC-022/049/013; SCN-11/13 |
| PB-022–PB-026 | J-01/J-10 | S01 | AC-001–006; SCN-01/10 |
| PB-027–PB-033 | J-02–J-12 | S01/S06 | AC-020–023/040–044/057 |
| PB-034–PB-038 | J-11 | S01/S02/S03/S04 | AC-008–010/036–039 |
| PB-039–PB-044 | J-01/J-12 | S01/S05/S06 | AC-007/042/045–057 |
| PB-045–PB-050 | All | S06 | SCN-01–15; AC-058–060 |

### Governance requirements

| Governance requirement | Slice | Evidence |
|---|---|---|
| Simplicity/modular monolith | All | Architecture review; no extra services |
| Important action lifecycle logs | S01/S06 | AC-040 |
| Central typed config | S01 | AC-007 |
| Secret/password safety | S01/S06 | AC-042/058 |
| Stateless backend | S01 | restart/persistence SCN-11 |
| Every major route/flow tested | S06 | SCN-01–15 |
| 5–20 real-life scenarios | S06 | 15 scenarios |
| Real PostgreSQL proof | S01/S06 | DB evidence section |
| TypeScript/PostgreSQL portability | S01 | build/migration tests |
| Capacitor preferred | S05 | AC-046/047/051 |
| Backend container | S01/S06 | AC-052–057 |

---

## 9. Coverage Audit

- Product requirements defined: **50**
- Product requirements mapped to slices: **50/50**
- Product requirements mapped to evidence: **50/50**
- Major journeys defined: **12**
- Major journeys represented by acceptance scenarios/tests: **12/12**
- Canonical examples preserved: **4/4**
- Authentication/authorization evidence present: **Yes**
- Detailed database evidence present: **Yes**
- Container evidence present: **Yes**
- Mobile human evidence present: **Yes**
- Unmapped Must requirements: **0**

**Coverage verdict:** Ready for Gate A review; not yet approved for implementation until Gate A decisions in `ARCHITECTURE.md` are accepted.
