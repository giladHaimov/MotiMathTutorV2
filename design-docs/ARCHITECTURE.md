# ARCHITECTURE.md

## 1. Status

**Decision status:** Proposed for Gate A approval.  
**Architecture style:** Small modular monolith.  
**Primary goal:** The simplest architecture that reliably enforces server-side reasoning state.

---

## 2. Frozen Technology Decisions

| Area | Decision |
|---|---|
| Language | TypeScript, strict mode |
| Runtime | Current supported Node.js LTS |
| Repository | npm workspaces monorepo |
| Web client | React + Vite |
| Mobile | Capacitor wrapping the same web build |
| API | Fastify |
| Validation | Zod schemas shared through `packages/contracts` |
| Authentication | Better Auth, email/password, PostgreSQL/Drizzle adapter; cookie session for web and approved bearer/session-token path for Capacitor |
| Database | Standard PostgreSQL |
| DB access | Drizzle ORM with explicit SQL migrations and `node-postgres` |
| Logging | Fastify/Pino structured JSON logs |
| Unit tests | Vitest |
| DB integration | Vitest + real PostgreSQL/Testcontainers or Docker Compose |
| Browser E2E | Playwright against real API and DB |
| Mobile smoke | Capacitor Android/iOS build plus simulator/device human smoke |
| Packaging | Production multi-stage Dockerfile for backend/web server |
| Local environment | Docker Compose for PostgreSQL and application acceptance |
| CI | GitHub Actions |
| Cache | None in MVP |

No Redis, queue, microservice, event bus, Kubernetes, serverless-only runtime, or analytics warehouse is introduced.

---

## 3. System Shape

```text
React/Vite Web Application
        │
        ├── Browser deployment
        └── Capacitor Android/iOS packages
                    │
                 HTTPS/JSON
                    │
             Fastify Modular Monolith
        ┌───────────┼───────────────────────┐
        │           │                       │
 Better Auth   Reasoning Engine        Content Import
        │           │                       │
        └────────── PostgreSQL ─────────────┘
```

The backend is stateless between requests. Durable state lives in PostgreSQL.

The client:

- renders server state;
- sends structured actions;
- caches only replaceable presentation state;
- never decides whether an action is semantically valid;
- never receives hidden future chunks.

---

## 4. Repository Layout

```text
/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── app.ts
│   │   │   ├── server.ts
│   │   │   ├── config/
│   │   │   ├── auth/
│   │   │   ├── routes/
│   │   │   ├── modules/
│   │   │   │   ├── profile/
│   │   │   │   ├── content/
│   │   │   │   ├── sessions/
│   │   │   │   └── engine/
│   │   │   ├── db/
│   │   │   └── logging/
│   │   └── tests/
│   └── web/
│       ├── src/
│       │   ├── app/
│       │   ├── features/auth/
│       │   ├── features/dashboard/
│       │   ├── features/problem/
│       │   └── lib/api/
│       ├── capacitor.config.ts
│       ├── android/
│       └── ios/
├── packages/
│   ├── contracts/
│   ├── engine/
│   └── problem-content/
│       ├── schema/
│       └── fixtures/
├── db/
│   ├── migrations/
│   └── seeds/
├── tests/
│   ├── invariants/
│   ├── integration/
│   ├── e2e/
│   └── fixtures/canonical-examples/
├── Dockerfile
├── docker-compose.yml
└── .github/workflows/ci.yml
```

`packages/engine` contains pure deterministic reasoning functions. It does not import Fastify, React, or database clients.

---

## 5. Module Boundaries

### Auth module

Responsibilities:

- registration, login, logout, session validation;
- mapping auth user to pseudonymous application profile;
- request authentication.

It does not decide access to a specific learning session; session authorization belongs to the session module.

### Content module

Responsibilities:

- schema validation of versioned problem fixtures;
- deterministic next-problem selection;
- retrieving server-only problem definitions;
- returning only currently visible chunks to the session engine.

### Session module

Responsibilities:

- create, load, authorize, resume, and complete sessions;
- state-version concurrency;
- idempotency;
- transaction boundary;
- persistence.

### Engine module

Pure deterministic functions:

- validate action schema and current-state permission;
- check semantic sufficiency;
- validate typed-slot placement;
- classify misconception;
- calculate rollback;
- calculate next state and visible content.

### Client

Responsibilities:

- authentication UI;
- dashboard;
- render visible chunks and workspace;
- submit action commands;
- handle conflict/current-state responses;
- retry safely using the same `client_action_id`;
- render server messages.

---

## 6. API Surface

All API responses use JSON. Errors use:

```json
{
  "error": {
    "code": "STATE_VERSION_CONFLICT",
    "message": "The session changed. Reloaded current state.",
    "request_id": "..."
  }
}
```

### Public operational endpoint

| Method | Route | Auth | Purpose |
|---|---|---:|---|
| GET | `/health` | No | Liveness/readiness without secrets |

### Auth endpoints

Mounted under `/api/auth/*` through Better Auth.

### Student endpoints

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/me` | Current pseudonymous profile summary |
| GET | `/api/dashboard` | Unfinished session or next-problem availability |
| POST | `/api/sessions` | Start next deterministic problem |
| GET | `/api/sessions/:sessionId` | Resume authorized session |
| POST | `/api/sessions/:sessionId/actions` | Submit one structured action |

There is no public route that returns raw full problem definitions or arbitrary problem content.

### Action request

```json
{
  "client_action_id": "uuid",
  "expected_state_version": 4,
  "action_type": "ASSIGN_SLOT",
  "payload": {
    "slot": "WHOLE",
    "token_id": "chunk-1-token-2"
  }
}
```

### Session response

```json
{
  "session_id": "uuid",
  "state_version": 5,
  "status": "ACTIVE",
  "visible_chunks": [],
  "workspace": {},
  "accepted_commitments": [],
  "required_next_action": {},
  "allowed_actions": [],
  "message": null,
  "engine_version": "1.0.0",
  "content_version": 1
}
```

The response serializer is allowlist-based. Raw content-definition fields cannot leak accidentally.

---

## 7. Action Types

MVP action types:

- `ASSIGN_SLOT`
- `DELETE_ASSIGNMENT`
- `SUBMIT_COMMITMENT`
- `ACKNOWLEDGE_INSUFFICIENT_INFORMATION`
- `SUBMIT_FINAL_ANSWER`

Every action is validated against:

1. authenticated owner;
2. request schema;
3. `expected_state_version`;
4. current allowed-action set;
5. problem definition;
6. semantic sufficiency;
7. typed-workspace invariants.

---

## 8. State Transition Contract

The session engine receives:

```text
problem definition
+ current durable session state
+ action
+ relevant attempt history
```

It returns:

```text
accepted/rejected
+ next durable state
+ attempt outcome
+ learning events
+ optional rollback record
+ public response
```

The engine performs no database I/O. The session service owns the transaction.

### Transaction algorithm

1. Begin transaction.
2. Insert or find `stage_attempts` by `(session_id, client_action_id)`.
3. If duplicate and completed, return stored public result.
4. Lock the `learning_sessions` row `FOR UPDATE`.
5. Authorize owner.
6. Compare `expected_state_version`.
7. Load pinned problem definition and relevant rules.
8. Execute pure engine transition.
9. Update attempt outcome.
10. If accepted, update session state and increment state version.
11. Insert one or more `learning_events`.
12. Insert `rollback_logs` when applicable.
13. Commit.
14. Return the persisted public result.

A rejected semantic action is still a completed attempt and learning event, but it does not advance session state unless the defined response changes guidance/acknowledgment state.

---

## 9. Detailed Database Schema

All timestamps are `timestamptz`. UUIDs are generated server-side or by PostgreSQL. JSONB columns have application-level Zod schemas and targeted database checks where practical.

### 9.1 `auth_users` — managed by Better Auth

| Column | Type | Rules |
|---|---|---|
| `id` | text | PK |
| `name` | text | nullable/minimal |
| `email` | text | unique, not null |
| `email_verified` | boolean | not null, default false |
| `image` | text | nullable |
| `created_at` | timestamptz | not null |
| `updated_at` | timestamptz | not null |

**Ownership/lifecycle:** Authentication subsystem. Deleted only through explicit account lifecycle logic.  
**Used by:** J-01 registration/login; J-10 logout/isolation.

### 9.2 `auth_sessions` — managed by Better Auth

| Column | Type | Rules |
|---|---|---|
| `id` | text | PK |
| `user_id` | text | FK `auth_users.id`, cascade |
| `token` | text | unique, secret-bearing; never logged |
| `expires_at` | timestamptz | not null |
| `ip_address` | text | nullable; retention minimized |
| `user_agent` | text | nullable; retention minimized |
| `created_at` | timestamptz | not null |
| `updated_at` | timestamptz | not null |

Indexes: `token` unique; `user_id`; `expires_at`.  
**Used by:** Every authenticated journey, especially J-01/J-10.

### 9.3 `auth_accounts` — managed by Better Auth

| Column | Type | Rules |
|---|---|---|
| `id` | text | PK |
| `user_id` | text | FK `auth_users.id`, cascade |
| `account_id` | text | not null |
| `provider_id` | text | not null |
| `password` | text | nullable strong salted hash; never logged |
| `access_token` | text | nullable/encrypted or omitted for MVP |
| `refresh_token` | text | nullable/encrypted or omitted for MVP |
| `access_token_expires_at` | timestamptz | nullable |
| `refresh_token_expires_at` | timestamptz | nullable |
| `scope` | text | nullable |
| `id_token` | text | nullable/encrypted or omitted |
| `created_at` | timestamptz | not null |
| `updated_at` | timestamptz | not null |

Unique: `(provider_id, account_id)`. Index: `user_id`.  
**Used by:** J-01 authentication. Email/password only in MVP.

### 9.4 `auth_verifications` — managed by Better Auth

| Column | Type | Rules |
|---|---|---|
| `id` | text | PK |
| `identifier` | text | not null |
| `value` | text | not null, secret-bearing |
| `expires_at` | timestamptz | not null |
| `created_at` | timestamptz | nullable |
| `updated_at` | timestamptz | nullable |

Index: `identifier`; periodic expiry cleanup.  
**Used by:** Auth verification/password-reset flows when enabled.

### 9.5 `user_profiles`

| Column | Type | Rules |
|---|---|---|
| `auth_user_id` | text | PK/FK `auth_users.id`, cascade |
| `analytics_subject_id` | uuid | unique, not null |
| `status` | text | check `ACTIVE`, `DELETED` |
| `created_at` | timestamptz | not null |
| `deleted_at` | timestamptz | nullable |

Indexes: unique `analytics_subject_id`.  
**Ownership:** Student identity mapping.  
**Lifecycle:** Created atomically/lazily after first authenticated access; deleted/anonymized by explicit lifecycle flow.  
**Used by:** J-01, every session authorization flow, pseudonymous learning records.

### 9.6 `programs`

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | PK |
| `slug` | text | not null |
| `name` | text | not null |
| `version` | integer | > 0 |
| `status` | text | check `DRAFT`, `ACTIVE`, `RETIRED` |
| `created_at` | timestamptz | not null |

Unique: `(slug, version)`. Index: `(status, slug)`.  
**Lifecycle:** Immutable after activation; new version creates a new row.  
**Used by:** J-02 next selection, J-11 import.

### 9.7 `problems`

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | PK |
| `program_id` | uuid | FK `programs.id`, restrict |
| `problem_key` | text | not null |
| `version` | integer | > 0 |
| `domain` | text | check `PERCENT`, `RATIO`, `FRACTION` |
| `title` | text | not null |
| `difficulty_level` | integer | bounded MVP scale |
| `full_text` | text | not null, server-only |
| `definition` | jsonb | not null, schema-validated |
| `status` | text | check `DRAFT`, `ACTIVE`, `RETIRED` |
| `created_at` | timestamptz | not null |

Unique: `(program_id, problem_key, version)`.  
Indexes: `(program_id, status, difficulty_level)`; `(domain, status)`.  
**Lifecycle:** Immutable after activation.  
**Used by:** J-02, J-04–J-08, J-11. Never returned raw through public API.

### 9.8 `chunks`

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | PK |
| `problem_id` | uuid | FK `problems.id`, cascade |
| `order_index` | integer | >= 0 |
| `chunk_type` | text | controlled enum |
| `content` | text | not null |
| `semantic_definition` | jsonb | not null |
| `created_at` | timestamptz | not null |

Unique: `(problem_id, order_index)`. Index: `(problem_id, order_index)`.  
**Lifecycle:** Immutable with problem version.  
**Used by:** J-02/J-03/J-04 progressive reveal; never bulk-returned publicly.

### 9.9 `misconception_classes`

| Column | Type | Rules |
|---|---|---|
| `code` | text | PK |
| `name` | text | not null |
| `description` | text | not null |
| `active` | boolean | default true |
| `created_at` | timestamptz | not null |

**Lifecycle:** Versioned through fixture deployment; existing codes are not redefined incompatibly.  
**Used by:** J-05/J-06/J-07 and analytics queries.

### 9.10 `rollback_rules`

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | PK |
| `problem_id` | uuid | FK `problems.id`, cascade |
| `misconception_code` | text | FK `misconception_classes.code`, restrict |
| `repeat_from` | integer | >= 1 |
| `rollback_depth` | integer | >= 0 |
| `guidance_code` | text | not null |
| `created_at` | timestamptz | not null |

Unique: `(problem_id, misconception_code, repeat_from)`.  
Index: `(problem_id, misconception_code)`.  
**Lifecycle:** Immutable with problem version.  
**Used by:** J-07 and EX-04.

### 9.11 `learning_sessions`

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | PK |
| `analytics_subject_id` | uuid | FK `user_profiles.analytics_subject_id`, restrict |
| `problem_id` | uuid | FK `problems.id`, restrict |
| `engine_version` | text | not null |
| `content_version` | integer | not null |
| `status` | text | check `ACTIVE`, `COMPLETED`, `ABANDONED` |
| `state_version` | integer | >= 0 |
| `current_chunk_index` | integer | >= 0 |
| `workspace_state` | jsonb | not null |
| `accepted_commitments` | jsonb | not null |
| `required_next_action` | jsonb | not null |
| `public_state` | jsonb | not null, allowlisted retry response |
| `started_at` | timestamptz | not null |
| `updated_at` | timestamptz | not null |
| `completed_at` | timestamptz | nullable |

Indexes: `(analytics_subject_id, status, updated_at desc)`; `(problem_id, status)`.  
Constraint: completed status requires `completed_at`.  
**Ownership:** Pseudonymous student. Authorization maps auth user → profile → subject.  
**Lifecycle:** Retained according to policy; never reassigned.  
**Used by:** J-02 through J-10.

### 9.12 `stage_attempts`

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | PK |
| `session_id` | uuid | FK `learning_sessions.id`, cascade |
| `client_action_id` | uuid | not null |
| `sequence_no` | integer | > 0 |
| `expected_state_version` | integer | >= 0 |
| `state_version_after` | integer | nullable |
| `action_type` | text | controlled enum |
| `payload` | jsonb | not null, sanitized |
| `outcome` | text | check `RECEIVED`, `ACCEPTED`, `REJECTED`, `CONFLICT`, `ERROR` |
| `misconception_code` | text | nullable FK |
| `public_result` | jsonb | nullable, allowlisted response for idempotent retry |
| `created_at` | timestamptz | not null |
| `completed_at` | timestamptz | nullable |

Unique: `(session_id, client_action_id)` and `(session_id, sequence_no)`.  
Indexes: `(session_id, created_at)`; `(misconception_code, created_at)`.  
**Lifecycle:** Append-only except completion fields set in the action transaction.  
**Used by:** Every action in J-04–J-09; primary idempotency record.

### 9.13 `learning_events`

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | PK |
| `session_id` | uuid | FK `learning_sessions.id`, cascade |
| `attempt_id` | uuid | nullable FK `stage_attempts.id`, cascade |
| `analytics_subject_id` | uuid | FK `user_profiles.analytics_subject_id`, restrict |
| `problem_id` | uuid | FK `problems.id`, restrict |
| `chunk_id` | uuid | nullable FK `chunks.id`, restrict |
| `event_type` | text | controlled vocabulary |
| `payload` | jsonb | not null, allowlisted and PII-free |
| `misconception_code` | text | nullable FK |
| `rollback_depth` | integer | nullable |
| `engine_version` | text | not null |
| `content_version` | integer | not null |
| `created_at` | timestamptz | not null |

Indexes: `(session_id, created_at)`; `(analytics_subject_id, created_at)`; `(event_type, created_at)`; `(misconception_code, created_at)`.  
**Lifecycle:** Append-only.  
**Used by:** J-02 through J-08; future analytics queries.

### 9.14 `rollback_logs`

| Column | Type | Rules |
|---|---|---|
| `id` | uuid | PK |
| `session_id` | uuid | FK `learning_sessions.id`, cascade |
| `attempt_id` | uuid | FK `stage_attempts.id`, cascade |
| `misconception_code` | text | FK `misconception_classes.code`, restrict |
| `from_chunk_index` | integer | >= 0 |
| `to_chunk_index` | integer | >= 0 |
| `rollback_depth` | integer | >= 0 |
| `repeat_count` | integer | >= 1 |
| `guidance_code` | text | not null |
| `created_at` | timestamptz | not null |

Unique: `attempt_id` to prevent duplicate rollback.  
Indexes: `(session_id, created_at)`; `(misconception_code, created_at)`.  
**Lifecycle:** Append-only.  
**Used by:** J-07 and future rollback-distribution analytics.

### Migration bookkeeping

Drizzle migration bookkeeping may create its own internal migration table/schema. It is infrastructure metadata, not product data, and is never accessed by application flows.

---

## 10. Table-to-Flow Usage Summary

| Table | Created/written in | Read in |
|---|---|---|
| `auth_users` | J-01 | All authenticated journeys |
| `auth_sessions` | J-01/J-10 | Every protected request |
| `auth_accounts` | J-01 | Login/account lifecycle |
| `auth_verifications` | Verification/reset only | Verification/reset only |
| `user_profiles` | J-01 | J-02–J-10 authorization and pseudonym mapping |
| `programs` | J-11 | J-02 selection |
| `problems` | J-11 | J-02–J-08 |
| `chunks` | J-11 | J-02–J-06 progressive reveal |
| `misconception_classes` | J-11 | J-05–J-07 |
| `rollback_rules` | J-11 | J-07 |
| `learning_sessions` | J-02; updated J-04–J-08 | J-03–J-10 |
| `stage_attempts` | J-04–J-09 | idempotent retry, repetition, audit |
| `learning_events` | J-02–J-08 | future analytics and acceptance verification |
| `rollback_logs` | J-07 | resume, audit, future analytics |

---

## 11. Authentication and Authorization Matrix

Legend: `O` own records only, `N` no access, `I` internal process only.

| Resource/action | Anonymous | Student | Content Import | Backend System |
|---|---:|---:|---:|---:|
| `/health` | Read | Read | Read | Read |
| Register/login | Execute | Execute/logout | N | Auth subsystem |
| Own profile | N | O read | N | Read/write mapping |
| Other profile | N | N | N | Only explicit maintenance |
| Active content metadata | N | Indirectly through session | I | Read |
| Raw full problem/chunks | N | N | I | Read |
| Start session | N | O create | N | Validate/create |
| Read session | N | O | N | Read |
| Submit session action | N | O | N | Validate/write |
| Read attempts/events | N | Not public in MVP | N | Internal/audit |
| Import content | N | N | I | Validate/write |
| Change active content | N | N | I | Apply |
| Read operational logs | N | N | N | Operations only |

Every session query includes the mapped `analytics_subject_id` ownership predicate. Knowledge of a UUID is never authorization.

---

## 12. Content Definition Shape

Each problem fixture includes:

- stable `problem_key`;
- immutable version;
- domain and difficulty;
- full server-only text;
- ordered chunks;
- tokens/semantic units;
- typed workspace slots;
- allowed action definitions;
- sufficiency dependencies;
- valid commitments;
- invalid commitment → misconception mapping;
- rollback rules;
- completion rule;
- expected final result.

Fixtures are validated before import. EX-01 through EX-04 are mandatory fixtures.

---

## 13. Configuration

All runtime configuration is read through one typed, validated module at startup.

Examples:

- `NODE_ENV`
- `PORT`
- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `TRUSTED_ORIGINS`
- `LOG_LEVEL`
- `ENGINE_VERSION`
- `CONTENT_SEED_MODE`

Rules:

- missing required configuration aborts startup;
- secrets are never logged;
- sanitized configuration is logged once at startup;
- environment changes require no source change;
- `.env.example` contains names and safe examples only.

---

## 14. Logging

### Operational logs

Important actions emit:

- `action_started`;
- `action_succeeded`;
- `action_failed`.

Required contextual fields where relevant:

- request ID;
- action name;
- session ID;
- attempt ID;
- duration;
- error code;
- safe structured context.

Never log:

- password/password hash;
- session token;
- bearer token;
- complete learning-event payload by default;
- email in learning-flow logs;
- future hidden chunk content.

### Learning events

Learning events are append-only database records for product behavior and analytics. They use `analytics_subject_id`, not email.

---

## 15. Testing Architecture

### `npm run check`

- formatting check;
- lint;
- TypeScript;
- unit tests.

### `npm run verify`

- `npm run check`;
- real PostgreSQL integration tests;
- clean migration test;
- canonical fixture validation/import test;
- Playwright scenarios against real API and PostgreSQL;
- production build;
- Docker build and smoke test.

### Invariants

- write → backend restart → read same session;
- cross-user session access denied;
- duplicate action changes state once;
- stale version changes nothing;
- accepted action + event are atomic;
- full problem is not exposed;
- clean migrations and seed import succeed;
- no API/DB mocks in release E2E;
- container starts without host `node_modules`.

There is no cache in MVP. Tests therefore prove PostgreSQL directly rather than testing cache behavior.

---

## 16. Container and Deployment

### Production image

A multi-stage Dockerfile:

1. installs locked dependencies;
2. builds packages, web, and API;
3. copies production runtime dependencies and web assets;
4. runs as non-root;
5. exposes the application port;
6. provides a health check;
7. starts the Fastify server, which serves API and built SPA assets.

### Startup

Application startup validates configuration and database connectivity. Migrations run as an explicit deploy/release command, not as an unsafe concurrent action by every replica.

### Docker Compose acceptance

Services:

- `postgres`;
- `app`.

Acceptance sequence:

1. build with `--no-cache`;
2. start empty PostgreSQL;
3. run migrations;
4. import canonical fixtures;
5. start app;
6. wait for `/health`;
7. run API and Playwright smoke;
8. restart app;
9. verify persisted session;
10. stop and remove volumes.

---

## 17. Capacitor Design

The same React/Vite build is used for browser and Capacitor.

Mobile-specific code is limited to:

- secure handling of the approved auth session/bearer token path;
- network/connectivity UX;
- platform build configuration;
- safe-area and keyboard behavior;
- app lifecycle resume.

No semantic decision code is added to native projects.

Gate A includes a small ProblemScreen feasibility check. If basic slot interaction, deletion, progressive reveal, and accessibility cannot meet acceptable UX, the deviation must be approved before implementation.

---

## 18. Security and Privacy

- HTTPS is required outside local development.
- Auth library security defaults are preserved.
- Password hashes are auth-library managed.
- Secrets use protected environment/deployment configuration.
- Learning data is pseudonymous.
- SQL access is parameterized through Drizzle.
- Authorization exists in service/repository queries.
- Request size and action payloads are bounded.
- Rate limiting is applied to authentication and action submission.
- Public response schemas are explicit allowlists.
- No raw content-definition endpoint is public.

---

## 19. Gate A Decisions

Human approval is required for:

1. This selected stack.
2. Better Auth email/password approach.
3. Capacitor feasibility for ProblemScreen.
4. The schema and JSONB state choice.
5. Deterministic next-problem selection.
6. Six-slice plan.
