# PRODUCT.md

## 1. Authority and Purpose

This document normalizes the mandatory product behavior from `PRODUCT_BOOK.md`.

Authority order:

1. `PRODUCT_BOOK.md` — original product intent.
2. `PRODUCT.md` — normalized product behavior.
3. `ARCHITECTURE.md` — frozen technical decisions.
4. `ACCEPTANCE.md` — required evidence and release gates.
5. `AGENTS.md` — coding-agent rules.
6. `slices/*.md` — bounded implementation scope.

If this document conflicts with the original Product Book, stop and resolve the conflict before implementation.

---

## 2. Product Summary

The product is a cloud-based tutoring system for mathematical word problems. It improves structural reasoning by progressively revealing semantic chunks and requiring valid semantic commitments before allowing progression.

The MVP supports:

- percentage problems;
- ratio problems;
- fraction problems;
- deterministic misconception classification;
- deterministic rollback;
- web usage;
- Android and iOS packaging through Capacitor;
- durable cloud sessions;
- real authentication and authorization;
- structured learning-event capture.

The product is not primarily an answer checker. It controls the reasoning process before the final numeric answer.

---

## 3. Users and Roles

### ROLE-STUDENT

An authenticated learner who may:

- start the next available problem;
- access only their own sessions;
- see only chunks currently revealed;
- place or delete semantic assignments;
- submit semantic commitments;
- acknowledge insufficient information;
- submit a final numeric answer when permitted;
- resume an incomplete session;
- view a simple completion result.

### ROLE-SYSTEM

Trusted backend execution that may:

- load versioned problem definitions;
- validate actions;
- update session state;
- classify misconceptions;
- execute rollback;
- record learning events and operational logs.

### ROLE-CONTENT-IMPORT

A non-public repository/CLI process that may:

- validate canonical problem fixture files;
- insert or update immutable versioned content;
- activate a selected content version.

There is no teacher, parent, researcher, or content-management UI in the MVP.

---

## 4. MVP Scope

### In scope

- Student registration, login, logout, and session validation.
- Deterministic next-problem selection.
- Progressive semantic-chunk disclosure.
- Typed semantic workspace.
- Commitment gating.
- Premature-commitment detection.
- Explicit insufficient-information acknowledgment.
- Misconception classification.
- Deterministic rollback.
- Durable session resume.
- Structured learning events.
- Operational logging.
- Percentage, ratio, and fraction problems.
- Versioned canonical problem content.
- Responsive web UI.
- Capacitor Android and iOS packages.
- Containerized backend.
- Automated tests plus explicit human acceptance tests.

### Explicit non-goals

- AI-generated problems.
- Geometry.
- Generalized algebra.
- Machine-learning-based adaptation.
- Analytics dashboard.
- Teacher or parent dashboard.
- CMS/admin UI.
- Payments.
- Social login.
- Real-time collaboration.
- Microservices.
- Offline-first reasoning logic.
- Client-side duplication of the semantic engine.

---

## 5. Core Product Concepts

### Semantic chunk

An ordered fragment of a word problem. The backend reveals chunks progressively.

### Commitment

A structured student assertion such as:

- assigning an entity/value to a typed slot;
- classifying Whole versus Subset;
- selecting a relation;
- identifying the Unknown;
- acknowledging that information is insufficient;
- submitting a final numeric result.

### Typed workspace

A server-authoritative workspace containing typed slots such as:

- Whole;
- Part-in-percentage;
- Part-in-number;
- Fraction;
- Ratio;
- Relational operator;
- Unknown.

The exact slots available are defined by the current problem version.

### Semantic sufficiency

The set of facts that must be revealed and accepted before a commitment is allowed.

### Misconception class

A deterministic category assigned to an invalid action, such as:

- `PREMATURE_QUANTIFICATION`;
- `WHOLE_PART_CONFUSION`;
- `UNKNOWN_MISIDENTIFICATION`;
- `RELATION_WITHOUT_OPERANDS`;
- `CONFLICTING_SLOT_ASSIGNMENT`;
- `COMPLEMENT_CONFUSION`.

### Rollback

A deterministic server action that returns the learner to an earlier reasoning stage or increases guidance after repeated equivalent errors.

---

## 6. Mandatory Product Requirements

### Progressive reasoning

- **PB-001** Problems are divided into ordered semantic chunks.
- **PB-002** Only currently revealed chunks are returned to the client.
- **PB-003** A required semantic commitment must be accepted before the next chunk is revealed.
- **PB-004** The client must never receive future hidden chunks or the complete problem prematurely.
- **PB-005** The workspace uses typed slots defined by the problem version.
- **PB-006** Invalid slot assignments block progression.
- **PB-007** Conflicting assignments require explicit deletion before progression.
- **PB-008** The system never silently auto-corrects an invalid structural assignment.
- **PB-009** Premature commitments are detected and blocked.
- **PB-010** When required, the learner must explicitly acknowledge insufficient information before progression.

### Misconceptions and rollback

- **PB-011** Invalid actions are mapped to a deterministic misconception class.
- **PB-012** Rollback behavior is deterministic and defined by misconception class.
- **PB-013** Repeated equivalent errors may increase rollback depth or guidance according to a fixed rule.
- **PB-014** Rollback actions and their cause are durably recorded.

### Sessions, actions, and versions

- **PB-015** Every student action includes `client_action_id`, `session_id`, `expected_state_version`, `action_type`, and structured payload.
- **PB-016** Duplicate `client_action_id` values are processed once only.
- **PB-017** Stale or out-of-order state versions are rejected safely without changing state.
- **PB-018** An accepted action, resulting session-state update, learning event, attempt record, and rollback record when applicable are committed atomically.
- **PB-019** A session can resume exactly after refresh, application restart, backend restart, or temporary network loss.
- **PB-020** Each session pins an engine version and problem/content version.
- **PB-021** Existing sessions continue using their pinned versions.

### Authentication and authorization

- **PB-022** Authentication is real and server-validated via Better Auth **cookie sessions** (browser and Capacitor). Capacitor loads the SPA from the configured API/server origin so cookies remain same-origin. JWT bearer authentication, `set-auth-token` issuance, and native-client proof via `Origin` / `User-Agent` / client-platform headers are **not** part of the product. Native clients are public clients.
- **PB-023** Every learning session belongs to one authenticated student.
- **PB-024** A student cannot read or modify another student’s profile, sessions, attempts, events, or history.
- **PB-025** Authorization is enforced by the backend, not only by UI visibility.
- **PB-026** Logout invalidates protected access according to the selected authentication library’s session model (cookie session invalidation).

### Data and logging

- **PB-027** Durable product state is stored in PostgreSQL; no production in-memory fallback exists.
- **PB-028** Every student action is represented in structured learning-event data.
- **PB-029** Learning events are separate from operational logs.
- **PB-030** Important state-changing operations log start, success, and failure where applicable.
- **PB-031** Operational logs exclude passwords, secrets, tokens, and unnecessary personal data.
- **PB-032** Behavioral records use a pseudonymous analytics identity rather than email.
- **PB-033** State remains correct after application restart.

### Content and canonical examples

- **PB-034** Problem definitions are immutable, versioned, schema-validated fixture/seed data.
- **PB-035** The repository contains seed/fixture representations of EX-01 through EX-04.
- **PB-036** No AI-generated dynamic problems exist in the MVP.
- **PB-037** Percent, ratio, and fraction problems are supported.
- **PB-038** Geometry and generalized algebra are excluded.

### Client and deployment

- **PB-039** Permanent reasoning logic resides only on the backend.
- **PB-040** The responsive web client renders server-provided state and sends structured actions.
- **PB-041** Android and iOS use the same web application through Capacitor unless Gate A rejects feasibility.
- **PB-042** The backend has a production Docker image, health check, and reproducible startup.
- **PB-043** Environment-specific configuration requires no source-code changes.
- **PB-044** Passwords are never stored or logged in plaintext; secrets are not committed or stored in ordinary application tables.

### Release quality

- **PB-045** Every major journey has automated or explicit human acceptance evidence.
- **PB-046** The release suite contains 5–20 realistic happy and sad user scenarios.
- **PB-047** Real database tests prove PostgreSQL use and persistence.
- **PB-048** No production TODO, mock, stub, fake authentication, disabled required test, or hidden persistence fallback remains at release.
- **PB-049** All in-scope Must requirements pass before release.
- **PB-050** Human device testing supplements automated testing before release.

---

## 7. Product Invariants

1. A session has exactly one owner.
2. A public response never contains unrevealed chunks.
3. A state transition requires the expected current state version.
4. A `client_action_id` affects state at most once.
5. An accepted action and its learning records are atomic with the state update.
6. Invalid or premature actions never advance the reveal position.
7. Conflicting workspace assignments remain blocked until explicitly deleted.
8. Existing sessions never silently change engine or content version.
9. Durable state is recoverable after process restart.
10. Mobile/web clients never decide semantic validity.
11. Learning-event payloads contain no email, password, auth token, or secret.
12. A student cannot access another student’s learning data.

---

## 8. Major User Journeys

### J-01 — Register, log in, and reach dashboard

**Happy path**

1. Student registers with email/password.
2. Server creates authentication records and a pseudonymous profile.
3. Student logs in.
4. Dashboard shows an unfinished session or the next available problem.

**Failure paths**

- Invalid credentials are rejected.
- Duplicate registration does not disclose unnecessary account information.
- Logged-out requests to the dashboard are rejected.
- Missing configuration causes startup failure, not insecure fallback.

### J-02 — Start a new learning session

**Happy path**

1. Authenticated student selects Start.
2. Server deterministically chooses the next problem version.
3. Server creates a session pinned to problem/content and engine versions.
4. Only the first permitted chunk and allowed actions are returned.
5. A learning event records session start.

**Failure paths**

- No active problem is available.
- Student attempts to choose a hidden or inactive problem version.
- Database transaction fails; no partial session/event remains.

### J-03 — Resume an existing session

**Happy path**

1. Student refreshes, restarts the app, or reconnects.
2. Client requests the session.
3. Backend authorizes ownership.
4. Exact reveal position, workspace, accepted commitments, required action, and version are returned.

**Failure paths**

- Another student requests the session.
- Session does not exist.
- Session is already completed.
- Client has stale cached state; server state remains authoritative.

### J-04 — Submit a valid commitment and reveal the next chunk

**Happy path**

1. Client sends a structured action with expected state version.
2. Server validates identity, ownership, action schema, and semantic sufficiency.
3. Server updates workspace/commitment state.
4. Server advances reveal position when gate conditions are satisfied.
5. Attempt and learning events are recorded atomically.
6. Client receives the new state and only newly permitted content.

**Failure paths**

- Payload is malformed.
- Action is not permitted in the current state.
- State version is stale.
- Duplicate action is retried.
- Database transaction fails.

### J-05 — Premature commitment

**Happy path**

1. Student attempts a commitment before required facts are revealed.
2. Server blocks progression.
3. Misconception is classified.
4. Server requires acknowledgment of insufficient information when configured.
5. Event and attempt are recorded.
6. Session state remains consistent.

**Failure paths**

- Client tries to bypass acknowledgment.
- Duplicate blocked action arrives.
- Client attempts a numeric answer before the answer action is allowed.

### J-06 — Conflict deletion

**Happy path**

1. Student creates a conflicting structural assignment.
2. Server classifies the conflict and blocks progression.
3. Client displays the server instruction.
4. Student explicitly deletes the conflicting assignment.
5. Server records deletion and permits the next valid action.

**Failure paths**

- Client hides the conflict locally without sending deletion.
- Student tries to advance while conflict remains.
- Student deletes an assignment they do not own or that is no longer present.

### J-07 — Repeated misconception and rollback

**Happy path**

1. Student repeats an equivalent misconception.
2. Backend counts relevant attempts under the deterministic rule.
3. Backend creates the configured rollback.
4. Session state, attempt, learning event, and rollback log commit atomically.
5. Client renders the rollback state and guidance.

**Failure paths**

- Rollback target is invalid for the current problem.
- Duplicate action must not cause a second rollback.
- Transaction failure must leave the previous state intact.

### J-08 — Complete a problem

**Happy path**

1. All required semantic gates are complete.
2. Final answer action becomes allowed.
3. Student submits the correct result.
4. Session status changes to completed.
5. Completion event is recorded.
6. Dashboard offers the next deterministic problem.

**Failure paths**

- Final answer submitted too early.
- Final answer is structurally based on the wrong unknown.
- Incorrect numeric answer does not mark completion.
- Completed session rejects later state-changing actions.

### J-09 — Network retry and stale client

**Happy path**

1. Mobile request succeeds but response is temporarily lost.
2. Client retries with the same `client_action_id`.
3. Backend returns the previously committed result without applying it twice.

**Failure paths**

- Client sends a new action based on an old version.
- Two devices send actions concurrently.
- Server returns a conflict response and authoritative current state.

### J-10 — Logout and cross-user isolation

**Happy path**

1. Student logs out.
2. Protected requests are rejected.
3. A second student logs in.
4. The second student cannot retrieve the first student’s sessions or history.

**Failure paths**

- Session identifier is guessed or copied.
- UI route is hidden but API is called directly.
- Cached client data must not authorize backend access.

### J-11 — Content import

**Happy path**

1. Repository fixture files are schema-validated.
2. Import runs idempotently.
3. Immutable problem versions, chunks, misconception classes, and rollback rules are inserted.
4. Selected versions become active for new sessions only.

**Failure paths**

- Duplicate version import is a no-op or explicit conflict.
- Invalid fixture fails before partial insertion.
- Existing sessions remain pinned to previous content.

### J-12 — Container startup and health

**Happy path**

1. Production image builds from a clean checkout.
2. PostgreSQL starts empty.
3. Migrations run.
4. Application validates configuration.
5. `/health` becomes ready.
6. Seed import can run explicitly.
7. Browser/API smoke test succeeds.

**Failure paths**

- Required secret/config is missing.
- Database is unavailable.
- Migration fails.
- Health must remain unhealthy; no insecure or in-memory fallback is used.

---

## 9. Canonical Worked Examples

These examples are product truth and must appear in fixture/seed files and acceptance tests.

### EX-01 — Percentage: identify whole and part

**Problem**

“A class has 40 students. Thirty percent wear glasses. How many students wear glasses?”

**Chunks**

1. `A class has 40 students.`
2. `Thirty percent wear glasses.`
3. `How many students wear glasses?`

**Required behavior**

- After chunk 1, `40 students` may be assigned to Whole.
- After chunk 2, `30%` may be assigned to Part-in-percentage and “wear glasses” identifies the subset.
- After chunk 3, Unknown is Part-in-number.
- `30%` in Whole is invalid.
- A conflicting occupied-slot assignment requires explicit deletion.
- Final result is `12 students`.

### EX-02 — Ratio: avoid premature quantification

**Problem**

“Red and blue marbles are in the ratio 2:3. There are 15 blue marbles. How many red marbles are there?”

**Chunks**

1. `Red and blue marbles are in the ratio 2:3.`
2. `There are 15 blue marbles.`
3. `How many red marbles are there?`

**Required behavior**

- Chunk 1 establishes ratio but not scale.
- Numeric answer before chunk 2 is blocked as premature.
- Chunk 2 establishes that three units equal 15.
- Chunk 3 identifies red marbles as Unknown.
- Final result is `10 red marbles`.

### EX-03 — Fraction: distinguish read from remaining

**Problem**

“Dana read three fifths of a 50-page booklet. How many pages remain unread?”

**Chunks**

1. `Dana read three fifths`
2. `of a 50-page booklet.`
3. `How many pages remain unread?`

**Required behavior**

- After chunk 1, page-count calculation is premature.
- After chunk 2, Whole is 50 and read fraction is 3/5.
- Chunk 3 defines Unknown as the complementary unread part.
- Treating 3/5 as the remaining fraction is invalid.
- Final result is `20 pages remain unread`.

### EX-04 — Conflict deletion and rollback

Use EX-01. The student places `40 students` in Part-in-number and later attempts to place `30%` in Whole.

**Required behavior**

- Both invalid assignments are rejected and recorded.
- Progression remains blocked until explicit deletion.
- Misconception class is deterministic.
- Repeated equivalent error triggers the configured rollback rule.
- No silent correction occurs.

---

## 10. Product Completion Definition

The MVP is product-complete only when:

- all PB-001 through PB-050 requirements are mapped and pass;
- EX-01 through EX-04 work from real fixture data;
- every major journey has automated or explicit human evidence;
- real authentication, authorization, PostgreSQL, container packaging, and Capacitor smoke tests pass;
- no hidden full-problem reveal route exists;
- no production mock, stub, TODO, fake auth, or in-memory fallback remains;
- Codex final acceptance reports no blocking findings;
- the human owner completes the defined release smoke test.
