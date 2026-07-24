# PRODUCT BOOK

This document defines the product intent, mandatory behavior, MVP boundaries, and worked examples. It is the authoritative product source used to generate project-specific design documents and implementation slices.

Technology notes in this Product Book are preferences, not final architecture. The generated `ARCHITECTURE.md` is responsible for selecting one coherent implementation stack.

# WHITE PAPER

## Commitment-Gated Semantic Transformation Engine

### A Cloud-Based Architecture for Structured Word Problem Mastery

# 1. Executive Overview

This document describes a cloud-based educational system designed to transform how students solve mathematical word problems.

The system does not focus on solution hints or answer checking. Instead, it implements a controlled reasoning-state architecture that:

- Enforces semantic commitment before progression
- Detects premature inferential collapse
- Maintains structural invariants
- Constructs typed intermediate representations prior to solution
- Adapts rollback depth based on misconception classification
The system is fully cloud-based, with Android and iOS applications serving as client interfaces.

The objective is measurable structural reasoning improvement, reduced dropout, and scalable domain expansion.

# 2. Core Problem

Students fail at word problems not primarily because of arithmetic difficulty, but because of:

- Premature classification
- Structural misunderstanding
- Early inferential collapse
- Propagation of early errors
- Inability to tolerate uncertainty
**Existing digital tutors:**

- Present full problems at once
- Evaluate answers post hoc
- Provide hints reactively
- Do not control reasoning state transitions
This system instead implements a commitment-gated reasoning state machine.

# 3. System Architecture

**The system consists of five major layers:**

## Layer 1: Semantic Chunk Engine

- Word problems are partitioned into ordered semantic chunks.
- Each chunk corresponds to a semantic unit:
  - Quantitative expression
  - Entity reference
  - Relational phrase
  - Event-defined subset
  - Unknown designation
Chunks are revealed progressively.

## Layer 2: Commitment-Gated Disclosure Engine

- Each chunk requires validated semantic commitment before next reveal.
- Commitment examples:
  - Classify entity as Whole or Subset
  - Translate lexical operator ("of") to multiplication
  - Identify relational equivalence
- Next chunk remains hidden until commitment is validated.

## Layer 3: Structured Workspace with Typed Semantic Slots

**Workspace contains typed slots such as:**

- Whole
- Part-in-percentage
- Part-in-number
- Relational operator
- Unknown
**The system enforces invariants:**

- Incorrect placement blocks progression
- Conflicting assignments require deletion
- Deletion is mandatory before proceeding

## Layer 4: Premature Commitment Detection Engine

**Maintains semantic sufficiency model:**

- Tracks which dependencies are satisfied
- Detects attempts to:
  - Quantify prematurely
  - Classify without sufficient context
  - Select relations before operands known
Blocks premature commitments.

Requires explicit acknowledgment of insufficient information.

Logs premature commitment frequency.

## Layer 5: Adaptive Rollback Controller

**When misconception is detected:**

- Rollback depth determined by misconception class
- Granularity increased if repeated error
- Strictness modulation based on history

# 4. Cloud Architecture

System is fully cloud-based.

**Client apps (Android/iOS):**

- Render problems
- Render workspace
- Send structured user actions
- Receive engine responses
**Cloud handles:**

- State machine logic
- Semantic sufficiency model
- Misconception classification
- Logging
- Analytics
- Engine versioning
No permanent reasoning logic resides on client.

# 5. Data Model (High Level)

**Core entities:**

- Users
- Programs
- Problems
- Chunks
- Sessions
- Stage Attempts
- Events
- Misconception Classes
- Rollback Logs
All reasoning actions are logged as structured events.

# 6. Analytics Layer (Future-Strength)

**From event logs we compute:**

- Premature commitment rate
- Rollback distribution
- Time-to-structural-stability
- Misconception transition matrix
- Dropout prediction signals
Analytics are not MVP priority but event logging is.

# 7. MVP Scope

**Initial domain:**

Word Problems only.

**Focus:**

- Percent
- Ratio
- Fraction-based problems
No geometry. No algebraic generalization.

Engine must support expansion later.

# 8. Mobile Application Design

**Apps must:**

- Authenticate user
- Fetch next problem stage
- Render visible chunk
- Render workspace slots
- Send structured action events
- Receive engine response
Apps must not compute logic locally.

State lives in cloud.

# 9. Security and Compliance

- Store minimal PII
- Separate user identity from behavioral analytics
- Prepare for GDPR / Israeli privacy compliance
- Encrypt traffic (HTTPS)
- Authentication: Better Auth **HTTP cookie sessions** for browser and Capacitor
  (same-origin Capacitor packaging via configured API/`server.url`).
- Native mobile clients are **public clients**. Caller-controlled signals
  (`Origin`, `User-Agent`, localhost/`capacitor://` origins, `X-Client-Platform`,
  and similar headers) must never be treated as proof of a trusted native app.
- JWT bearer tokens, `set-auth-token` issuance, and header/origin “native proof”
  were **intentionally removed**: a public Capacitor app cannot cryptographically
  prove “native” to the server with caller-controlled headers alone. Any future
  non-cookie auth requires a separately reviewed OAuth/OIDC Authorization Code +
  PKCE or device/app-bound cryptographic design.

> Obsolete history (not active): early Product Book drafts mentioned “Token-based
> authentication (JWT)”. That is **not** the implemented architecture.
# 10. Long-Term Expansion

**Architecture generalizes to:**

- Algebra
- Logic problems
- Structured reasoning domains
But not in MVP.

# 11. Mandatory Product Behavior

## 11.1 Session and action behavior

Each student action must include:

- `client_action_id` — unique per client action;
- `session_id`;
- `expected_state_version`;
- `action_type`;
- structured payload.

The server must:

- process duplicate `client_action_id` values once only;
- reject stale or out-of-order state versions safely;
- update session state and persist the corresponding learning event in one database transaction;
- return only the chunks and actions currently allowed for that session.

The public client API must never expose future hidden chunks or the complete problem before the reveal rules permit it.

## 11.2 Authentication and ownership

- Authentication must be real and server-validated.
- Every session belongs to one authenticated user.
- A user must not read or modify another user’s sessions, actions, or learning history.
- Authorization must be enforced on the server, not only in the UI.

## 11.3 State and versioning

Each active session must retain enough durable state to resume exactly after refresh, application restart, or temporary network loss.

At minimum, session data must preserve:

- user and problem identity;
- current reveal position;
- workspace state;
- accepted commitments;
- required next action;
- state version;
- engine version;
- problem/content version;
- completion status.

## 11.4 Event and operational logging

Learning events and operational logs are separate:

- **Learning events** record structured student actions, outcomes, misconception class, rollback, and engine/content versions.
- **Operational logs** record request/action start, completion, duration, and failures without secrets or unnecessary personal data.

Every important state-changing action must log start, success, and failure where applicable.

# 12. Implementation Preferences

Final choices are made in `ARCHITECTURE.md`, but defaults are:

- TypeScript for frontend and backend;
- modular monolith;
- PostgreSQL with provider portability, including local PostgreSQL or Supabase Postgres;
- one validated configuration module backed by environment/deployment configuration;
- proven authentication provider/library;
- web UI reusable through Capacitor for Android and iOS unless a short feasibility check shows another mobile technology is materially better;
- containerized production backend with health check and reproducible startup.

No permanent reasoning logic may reside in the mobile client.

# 13. Required Design Detail

The generated design package must include:

- a detailed database schema: every table, field, key, constraint, index, ownership rule, and lifecycle;
- the product flows in which each table is read or written;
- all major user flows with happy and failure paths;
- an authentication/authorization matrix for every relevant entity and action;
- mapping of every Must requirement to a Slice and to automated or explicit human acceptance evidence.

# 14. Canonical Worked Examples

These examples are product truth. The generated design documents, seed data, fixtures, and tests must preserve their intended behavior.

## EX-01 — Percentage: identify whole and part

**Problem:** “A class has 40 students. Thirty percent wear glasses. How many students wear glasses?”

**Ordered chunks:**

1. `A class has 40 students.`
2. `Thirty percent wear glasses.`
3. `How many students wear glasses?`

**Expected structural behavior:**

- After chunk 1, `40 students` may be assigned as the Whole.
- After chunk 2, `30%` is the Part-in-percentage and “wear glasses” identifies the subset.
- After chunk 3, the unknown is the Part-in-number.
- Placing `30%` in Whole is invalid and blocks progression.
- If a conflicting value is placed in an occupied typed slot, the conflicting assignment must be deleted before progression.
- Final numeric result: `12 students`.

## EX-02 — Ratio: avoid premature classification

**Problem:** “Red and blue marbles are in the ratio 2:3. There are 15 blue marbles. How many red marbles are there?”

**Ordered chunks:**

1. `Red and blue marbles are in the ratio 2:3.`
2. `There are 15 blue marbles.`
3. `How many red marbles are there?`

**Expected structural behavior:**

- Chunk 1 establishes two entities and a ratio, but not the scale.
- Attempting a numeric answer before chunk 2 is a premature commitment and must be blocked.
- Chunk 2 establishes that 3 ratio units equal 15 blue marbles.
- Chunk 3 identifies red marbles as the unknown.
- Final numeric result: `10 red marbles`.

## EX-03 — Fraction: distinguish read and remaining parts

**Problem:** “Dana read three fifths of a 50-page booklet. How many pages remain unread?”

**Ordered chunks:**

1. `Dana read three fifths`
2. `of a 50-page booklet.`
3. `How many pages remain unread?`

**Expected structural behavior:**

- After chunk 1, the fraction is known but the Whole is not; calculating a page count is premature.
- After chunk 2, `50 pages` is the Whole and `3/5` is the read fraction.
- Chunk 3 defines the unknown as the complementary unread part, not the read part.
- Treating `3/5` as the remaining fraction is invalid.
- Final numeric result: `20 pages remain unread`.

## EX-04 — Conflict deletion and rollback

Use EX-01, but the student first places `40 students` in Part-in-number and later attempts to place `30%` in Whole.

**Expected behavior:**

- Both assignments are rejected as structurally inconsistent.
- The system identifies the relevant misconception class.
- Progression remains blocked until the conflicting assignments are explicitly deleted.
- A repeated equivalent error triggers the configured deterministic rollback rule.
- No silent auto-correction is allowed.

# 15. MVP and Content Rules

- No AI-generated dynamic problems in the MVP.
- Problem definitions and canonical examples must be versioned, validated seed/fixture data.
- Keep the first implementation narrow and deterministic.
- Percent, ratio, and fraction problems are in scope; geometry and generalized algebra are not.
- No analytics dashboard is required for MVP, but structured learning events are required.

# 16. Release-Critical Rules

- No reasoning logic on mobile.
- No event/state split: each accepted action and its event persist atomically.
- No full-problem reveal bypass.
- No implicit auto-corrections without structural validation.
- Deletion is required before progression when a conflicting assignment violates an invariant.
- No production `TODO`, mock, stub, fake authentication, in-memory persistence fallback, or disabled required test at release.
- Seed and fixture data for canonical examples must exist under the repository’s test/seed structure.
