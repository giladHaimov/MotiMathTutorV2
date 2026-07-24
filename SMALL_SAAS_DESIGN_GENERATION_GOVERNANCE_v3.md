# SMALL-SAAS DESIGN GENERATION GOVERNANCE

**Purpose:**  
This file is the single cross-project instruction set to give an AI **before** it converts a Product Book into project-specific development documents and prompts.

**Audience:**  
AI systems that generate:

- `PRODUCT.md`
- `ARCHITECTURE.md`
- `ACCEPTANCE.md`
- `AGENTS.md`
- `slices/*.md`
- Claude Code Builder prompts
- Codex Reviewer prompts

**This file is not:**

- a Product Book;
- a project architecture;
- a coding-agent runtime state file;
- an orchestrator specification;
- a substitute for project-specific acceptance criteria.

The AI must apply only the rules relevant to the supplied project and must not copy this document wholesale into the generated files.

---

# 1. PRIMARY OBJECTIVE

Optimize for:

```text
minimum total human engineering effort
while producing a simple, maintainable, production-quality small SaaS
```

Do not optimize for:

- zero human involvement;
- maximum number of agents;
- impressive orchestration;
- speculative future scale;
- universal architecture;
- elimination of every possible risk through process machinery.

The target is normally:

- approximately 5,000–8,000 production LOC;
- a solo senior engineer;
- a modular monolith;
- real authentication and authorization;
- real PostgreSQL persistence;
- browser E2E;
- reproducible container packaging;
- optional Capacitor mobile wrapper;
- ordinary Git and CI.

---


# 1A. CORE EXECUTION RULES

## Simplicity first

Always choose the simplest design that satisfies current requirements safely.

Avoid:

- speculative abstractions;
- unnecessary services;
- elaborate frameworks;
- infrastructure added only for possible future scale.

Complexity requires explicit justification.

## Critical-action lifecycle logging

Every important state-changing, external, or operational action must produce:

1. a start log;
2. a success/completion log;
3. an error log when it fails.

Logs should include, where relevant:

- action name;
- correlation/request ID;
- entity ID;
- duration;
- safe context;
- error code and stack trace.

Never log passwords, secrets, tokens, or sensitive payloads.

Do not generate noisy before/after logs for trivial internal helper calls.

## Centralized configuration

All configuration must be accessed through one validated, typed configuration module.

Environment changes must require no source-code changes.

Use:

- environment variables or deployment configuration for environment-specific values;
- a secret manager or protected environment variables for secrets;
- optional version-controlled files only for non-secret defaults.

Do not require one plaintext “system-config file” containing all values.

## Passwords and secrets

- Passwords must never be stored or logged in plaintext.
- Passwords may be stored only as strong salted hashes, normally through a proven authentication library/provider.
- Application secrets, API keys, signing keys, and tokens must not be committed to source control or stored in ordinary application tables.
- Secrets must come from protected environment variables or a secret manager.

## Stateless service preference

Prefer stateless application services.

Durable state belongs in:

- PostgreSQL;
- object storage;
- an approved cache;
- another explicitly selected persistence system.

Do not keep business-critical state only in application memory.

Stateful components are allowed only when justified by the product.

## Major-flow test coverage

Every major product journey must have real end-to-end or integration evidence.

The test suite should normally include approximately 5–20 realistic user scenarios, scaled to project size, covering:

- happy paths;
- sad paths;
- invalid state transitions;
- permission failures;
- missing or changed data;
- recovery after errors.

These scenarios must imitate actual user behavior through the real application, API, authentication path, and database.

Example:

```text
login
→ open cart
→ add product A
→ add product B
→ remove product A
→ attempt checkout
→ verify product A is absent and totals remain correct
```

Release-evidence scenarios must not mock the application API or database.

## Database and cache verification

Do not clear all caches before every database-related test.

Instead, require dedicated persistence and integration tests that:

- run against real PostgreSQL;
- begin from a known clean database state;
- disable, clear, or bypass caches where necessary;
- verify writes directly in PostgreSQL;
- restart the application and verify persisted reads;
- separately test cache-hit, cache-miss, and cache-invalidation behavior when caching exists.

The objective is to prove that PostgreSQL is genuinely used, without making every test unnecessarily slow.

---

# 1B. SHORT PRODUCT-BOOK SUFFICIENCY CHECK

Before generating design documents, check whether any missing fact makes implementation impossible or forces invention of major product behavior.

- Stop only for genuinely blocking ambiguity.
- Return a short numbered list of questions, preferably no more than 10.
- Do not turn this check into a separate design phase.
- When reasonable safe decisions can be made under this governance, make them and record them.

Technology/process suggestions inside a Product Book are advisory unless explicitly preserved in the generated `ARCHITECTURE.md`.

---

# 2. REQUIRED OUTPUTS

Given a Product Book, generate exactly these project artifacts unless the project clearly requires an additional small document:

```text
PRODUCT.md
ARCHITECTURE.md
ACCEPTANCE.md
AGENTS.md
slices/01-*.md ... slices/0N-*.md
```

Also generate:

- one short Claude Code initialization prompt;
- one reusable per-slice Claude Code prompt;
- one lightweight Codex slice-review prompt;
- one deep Codex foundation-review prompt;
- one final Codex acceptance-review prompt.

Do not generate:

- custom orchestration code;
- workflow state machines;
- audit ledgers;
- Markdown parsers;
- provider adapters;
- hidden resume state;
- cryptographic fingerprints;
- universal build scripts;
- large governance documents duplicated inside the project.

---

# 3. AUTHORITY ORDER

Project documents must have a clear authority hierarchy:

1. Original Product Book — source of product intent.
2. `PRODUCT.md` — normalized product requirements and journeys.
3. `ARCHITECTURE.md` — frozen implementation decisions.
4. `ACCEPTANCE.md` — release requirements and required evidence.
5. `AGENTS.md` — coding-agent operating rules.
6. Slice files — bounded implementation scope.

If generated documents omit or reinterpret a Product Book requirement, the Product Book wins until the inconsistency is resolved.

The original Product Book must remain available for the final acceptance audit.

---

# 4. PRODUCT-BOOK NORMALIZATION

When generating `PRODUCT.md`:

## Preserve

- all Must requirements;
- all major user flows;
- user roles;
- permissions;
- business rules;
- success behavior;
- failure behavior;
- error and retry behavior;
- privacy and deletion requirements;
- mobile requirements;
- deployment requirements;
- integrations;
- non-goals;
- worked domain examples.

## Remove or consolidate

- repeated rationale;
- duplicated requirements;
- obsolete alternatives;
- historical discussion;
- implementation advice that belongs in architecture;
- vague phrases without testable meaning;
- ceremonial prose.

## Assign identifiers

Use stable identifiers such as:

```text
PB-001
PB-002
J-001
ROLE-USER
```

Every Must requirement must be traceable to:

- at least one user journey or operational flow;
- one slice;
- at least one acceptance criterion;
- one evidence method.

No Must requirement may disappear during compression.

---

# 5. REQUIRED TRACEABILITY

`ACCEPTANCE.md` must include a compact traceability table:

| Product requirement | Must? | Journey/flow | Slice | Acceptance criterion | Evidence |
|---|---:|---|---|---|---|

Rules:

- 100% of in-scope Must requirements must be mapped.
- Every major flow must have end-to-end evidence.
- Every role and permission rule must be mapped.
- Every data-lifecycle requirement must be mapped.
- Every container/mobile requirement must be mapped.
- Release requires 100% of in-scope Must criteria, not 90%.

Before code begins, the AI must perform a coverage self-check against the original Product Book.

---

# 5A. REQUIRED PROJECT-SPECIFIC DETAIL

The generated design documents must remain concise, but they must include:

## Detailed database schema

For every table define:

- fields and types;
- primary/foreign keys;
- nullability and defaults;
- unique/check constraints;
- important indexes;
- ownership and authorization;
- creation/update/delete lifecycle;
- every major flow that reads or writes the table.

## Major-flow catalog

For every major route/journey define:

- trigger;
- happy path;
- important failure path;
- data read/written;
- Slice;
- automated test or explicit human-test evidence.

## Authorization matrix

Map roles to create/read/update/delete/execute permission for each relevant entity or operation.

## Canonical examples

When the Product Book contains worked examples, preserve 3–5 of them in `PRODUCT.md` with stable IDs. Generated seed/fixture files and acceptance tests must reference those IDs.

Automated testing may be partial for a very small SaaS, but every Must requirement and major flow must have either automated evidence or a precise human-test procedure.

---

# 6. ARCHITECTURE PRINCIPLES

Default philosophy:

```text
boring wins
simplicity over cleverness
explicit behavior over hidden magic
deterministic systems
small modules
low operational complexity
```

Default architecture:

```text
modular monolith
single primary PostgreSQL database
one coherent authentication system
one canonical deployment model
```

Avoid unless explicitly justified:

- microservices;
- Kubernetes;
- service meshes;
- distributed databases;
- event buses;
- multiple backend frameworks;
- multiple ORMs;
- multiple authentication paths;
- speculative abstractions;
- unnecessary indirection;
- framework magic that hides critical behavior.

The generated `ARCHITECTURE.md` must choose one coherent stack.  
It must not contain unresolved choices such as “Next.js or Fastify” or “Drizzle or Prisma.”

---


# 6A. DEFAULT TECHNOLOGY PREFERENCES

These are defaults, not absolute mandates. A deviation requires a concise project-specific justification.

## Preferred language

Use **TypeScript** as the default language for small SaaS products, including frontend and backend where practical.

Choose another language only when it provides a material advantage in:

- reliability;
- ecosystem fit;
- performance;
- platform constraints;
- development speed.

Do not introduce multiple backend languages without a strong need.

## PostgreSQL-provider portability

The database layer should remain portable across ordinary PostgreSQL providers, such as:

- local PostgreSQL;
- Supabase Postgres;
- Neon;
- AWS RDS PostgreSQL;
- managed PostgreSQL from another provider.

Prefer:

- standard PostgreSQL behavior;
- explicit migrations;
- provider-neutral database access;
- application-owned schema and constraints.

Avoid unnecessary dependence on proprietary provider features.

Do not build a generic abstraction for unrelated RDBMS engines such as PostgreSQL, MySQL, and SQL Server unless cross-database support is an explicit product requirement.

Supabase is a PostgreSQL platform/provider, not a separate RDBMS.

## Preferred mobile technology

For an existing web product, prefer **Capacitor** as the default mobile application approach.

The objective is to reuse the production web application while adding only the native integration actually required.

Choose Flutter, React Native, native development, or another technology only when Capacitor cannot provide acceptable:

- UX;
- performance;
- offline behavior;
- native-device integration;
- platform compliance.

Any deviation should be justified in `ARCHITECTURE.md`.

## Backend container packaging

A production backend should normally include:

- a production Dockerfile;
- documented environment variables;
- a health check;
- reproducible build and startup commands;
- a clean container smoke test.

The container should allow deployment across ordinary container-capable providers without source changes.

Container packaging may be omitted only when the selected architecture is intentionally platform-native/serverless and a container would add complexity without useful portability. The exception must be explicit in `ARCHITECTURE.md`.

---

# 7. ARCHITECTURE CONTENT

`ARCHITECTURE.md` should define:

## 7.1 System shape

- runtime;
- web/client framework;
- backend framework;
- PostgreSQL access layer;
- authentication library/provider;
- deployment model;
- mobile packaging strategy if applicable.

## 7.2 Module boundaries

Prefer explicit modules such as:

```text
web/client
server/routes
domain
db/repositories
integrations
tests
```

Business logic should be separated from transport and persistence where practical.

Route/controller code should remain thin.

## 7.3 Data model

For every core entity define:

- fields and types;
- nullability;
- defaults;
- primary key;
- foreign keys;
- unique constraints;
- indexes;
- ownership;
- delete behavior;
- source of truth;
- whether any field is derived.

External IDs must normally be stored as text/string.

Derived aggregates should normally be computed from base data rather than incremented manually.

## 7.4 Source of truth

For external or synchronized data, include:

| Entity/field | Owner | Local table | External mirror? | Conflict rule |
|---|---|---|---:|---|

If ownership is unclear, mark it as a material ambiguity.

The coding agent must not invent ownership rules.

## 7.5 Security model

Define separately:

- authentication;
- authorization;
- resource ownership;
- tenant isolation;
- admin capabilities;
- session behavior;
- logout expectations;
- destructive-action protections.

Do not treat authentication as authorization.

## 7.6 Failure model

For relevant operations define:

- timeout;
- retry limit;
- idempotency key;
- duplicate-event behavior;
- transaction boundary;
- rollback behavior;
- partial-failure behavior;
- logging requirements.

## 7.7 Observability

At minimum require:

- structured request logging;
- contextual error logs;
- startup configuration logging with secrets removed;
- `/health`;
- production-safe diagnostics appropriate to the project.

Do not require `/debug` in production unless access is explicitly secured.

---

# 8. DATA-INTEGRITY RULES

Apply when relevant:

- Validate inputs early.
- Fail loudly on invalid state.
- Multi-step writes must use database transactions.
- Prefer database constraints as final integrity enforcement.
- Prefer row locks or transactional concurrency control over application-level distributed locks.
- External events must be idempotent.
- Duplicate events must not duplicate state.
- Retries must be bounded.
- External calls must have timeouts.
- No silent fallback to an in-memory store.
- No hidden SQLite substitute when PostgreSQL is required.
- No partial state persistence after a failed multi-step operation.
- Configuration comes from environment variables.
- Secrets must never be committed or logged.

Do not force event-processing rules into a project with no external events.

Only include relevant rules.

---

## User-action consistency

For state-changing client actions, require a unique client action ID and expected state version where duplicate delivery or stale actions are possible.

- Duplicate actions must not apply twice.
- Stale/out-of-order actions must fail safely.
- Session-state update and corresponding domain-event insert must occur in one database transaction.
- Public APIs must return only currently visible/authorized content; hidden future content must not be retrievable through an alternate route.

---

# 9. AUTHENTICATION AND AUTHORIZATION EVIDENCE

For any multi-user product, `ACCEPTANCE.md` must require evidence for:

```text
unauthenticated request → 401
invalid/expired session → rejected
User A cannot read User B resource
User A cannot update/delete User B resource
ordinary user cannot use admin operation
protected browser route rejects logged-out user
```

Where tenant isolation applies:

```text
Tenant A cannot access Tenant B data
```

Tests must exercise the real authentication path.

Forbidden evidence:

- caller-controlled identity headers;
- hardcoded test identities in production code;
- mocked authentication as proof of integration;
- UI-only authorization without server enforcement.

---

# 10. REAL DATABASE EVIDENCE

The project must prove that PostgreSQL is part of the real runtime path.

Required invariant where applicable:

```text
write through real application
→ stop/restart application
→ read same record
```

Additional required checks:

- migrations succeed from an empty database;
- integration tests use real PostgreSQL;
- data is directly visible in PostgreSQL;
- invalid operations do not write partial rows;
- clean database startup works;
- no in-memory fallback exists in production code.

A schema file or ORM model alone is not evidence of real database implementation.

---

# 11. TESTING MODEL

Every project should define:

## 11.1 Fast gate

```text
npm run check
```

Typical contents:

- format check;
- lint;
- typecheck;
- unit tests.

## 11.2 Full gate

```text
npm run verify
```

Typical contents:

- `npm run check`;
- integration tests;
- clean-database migration test;
- Playwright E2E;
- production build;
- Docker/container smoke test.

The exact commands may differ, but there must be one canonical full gate.

## 11.3 Test layers

### Unit tests

For:

- pure domain logic;
- boundary cases;
- state transitions;
- calculations;
- deterministic rules.

### Integration tests

For:

- PostgreSQL;
- transactions;
- authorization;
- migrations;
- external adapters;
- rollback;
- idempotency.

### Browser E2E

For:

- every major user journey;
- the primary value journey;
- at least one important failure path;
- real API and database paths.

E2E tests must not mock the application API or database when used as release evidence.

---

# 12. FIXED INFRASTRUCTURE INVARIANTS

Generate project-relevant invariant requirements from this catalog:

1. Write, restart, and read persisted data.
2. Unauthenticated access receives 401.
3. Cross-user or cross-tenant access is blocked.
4. Migrations run on a clean PostgreSQL database.
5. Multi-step failure rolls back fully.
6. Core Playwright journey uses real backend and DB.
7. Docker/container health check succeeds.
8. Invalid input creates no partial state.
9. Clean-clone verification succeeds.
10. No production auth bypass or in-memory repository exists.
11. Deletion/export is real when required.
12. Duplicate external events are idempotent when applicable.
13. Required external calls have bounded timeout/retry behavior.
14. Logs include enough context to diagnose non-trivial failures.
15. No secrets appear in source or logs.

Only include applicable invariants, but never omit auth, DB, packaging, or major-flow evidence when those features exist.

---

# 13. CONTAINER PACKAGING REQUIREMENTS

If Docker/container packaging is required, `ACCEPTANCE.md` must require a clean environment test:

```bash
docker compose build --no-cache
docker compose up -d
```

Then verify:

- required services start;
- PostgreSQL starts with empty storage;
- migrations run;
- health endpoint becomes ready;
- API smoke test succeeds;
- browser E2E runs against the containerized app;
- application restart preserves data;
- required environment variables are documented;
- no host `node_modules` or undeclared host files are required;
- production image runs with production configuration.

A successful `docker build` alone is not sufficient.

---

# 14. VERTICAL-SLICE DESIGN

Generate 4–7 vertical slices.

Each slice must contain:

- purpose;
- Product Book IDs;
- acceptance IDs;
- user journey/flow;
- scope;
- explicit non-goals;
- expected files/modules;
- required tests;
- material risks;
- definition of done.

A vertical slice should cross the relevant layers:

```text
UI/client
→ API
→ validation
→ domain
→ database
→ tests
```

Avoid horizontal phases such as:

- “all database work”;
- “all APIs”;
- “all frontend”;
- “tests at the end.”

## Recommended first slice

The first slice should establish trust by proving:

- real authentication;
- real PostgreSQL;
- migrations;
- authorization/ownership;
- one thin but real core product journey from UI/API through domain logic and persistence;
- action idempotency/state-version behavior when relevant;
- no hidden-content or authorization bypass;
- CI;
- Docker startup.

## Later slices

Typical order:

1. Trust foundation.
2. Core value journey.
3. Domain rules and failure paths.
4. Operational/admin/privacy/integrations.
5. Release hardening and optional mobile packaging.

Adapt to the product; do not force irrelevant phases.

---

# 15. AMBIGUITY POLICY

Classify ambiguity:

## Material

Examples:

- product behavior;
- ownership;
- permissions;
- destructive actions;
- billing semantics;
- architecture choice;
- external-data conflict rule.

Action:

```text
stop and ask
```

## Minor implementation choice

Examples:

- internal helper name;
- equivalent low-risk library usage within approved stack;
- reversible file organization.

Action:

```text
choose the safest conventional option and record it
```

## Cosmetic and reversible

Action:

```text
decide autonomously
```

Do not make the agent stop for every small decision.

Do not let it invent product behavior.

---

# 16. AGENT OPERATING RULES

`AGENTS.md` should be short and include only project-relevant rules.

Default rules:

- Read authoritative documents before coding.
- Implement one slice only.
- Do not alter product or architecture documents.
- Do not weaken CI or invariant tests.
- Use real auth and real PostgreSQL.
- Do not add a second framework or service.
- Do not introduce mocks into production paths.
- Do not expand scope.
- New dependencies require justification.
- Run the canonical verification command.
- Stop after bounded repair attempts.
- Report assumptions, deviations, evidence, and residual risk.
- Do not declare the full product release-ready.

Target: approximately 80–150 high-signal lines, not a large governance manual.

---

# 17. CLAUDE CODE BUILDER PROMPTS

Generate:

## 17.1 Initialization prompt

Purpose:

- inspect Product Book and generated documents;
- identify contradictions;
- propose slices;
- make no code changes.

## 17.2 Per-slice prompt

It must instruct Claude to:

1. implement only one named slice;
2. list PB/AC items in scope;
3. provide a short plan;
4. identify material ambiguities;
5. write implementation and tests;
6. run `npm run verify`;
7. perform bounded repairs;
8. commit;
9. report evidence;
10. stop.

## 17.3 Repair rule

Default:

```text
two serious repair attempts by Claude
then stop and escalate
```

A third attempt may use:

- a short human hint;
- Codex as fallback Builder;
- a fresh diagnosis.

Never permit endless repair loops or test weakening.

---

# 18. CODEX REVIEW PROMPTS

Generate three review prompts.

## 18.1 Lightweight slice conformance review

After each slice, check:

- PB/AC coverage;
- scope compliance;
- tests proving behavior;
- architecture deviations;
- verification weakening;
- obvious bugs;
- fake implementations.

Output only actionable findings.

## 18.2 Deep foundation review

After Slice 1, check deeply:

- real authentication;
- authorization;
- tenant/user isolation;
- real PostgreSQL;
- migrations;
- persistence after restart;
- CI integrity;
- Docker startup;
- E2E realism;
- architecture quality.

## 18.3 Final acceptance review

Review against:

- original Product Book;
- `PRODUCT.md`;
- `ARCHITECTURE.md`;
- `ACCEPTANCE.md`;
- all Must requirements.

Check:

- all major flows;
- missing requirements;
- auth and authorization;
- persistence and transactions;
- failure paths;
- privacy/destructive actions;
- browser E2E;
- packaging/deployment;
- test quality;
- weakened or skipped verification.

Codex should review first and not normally fix its own findings. It may add temporary or audit-branch black-box tests when useful, without changing production implementation. The final audit must also verify any explicit human-test procedures used for requirements that are not practical to automate.

Default repair path:

```text
Codex finds
→ Claude fixes
→ verification reruns
```

---

# 19. REVIEW AND RELEASE RULES

## Human checkpoints

### Gate A

Approve:

- architecture;
- data model;
- auth/authorization model;
- slice plan;
- material product decisions.

### Gate B

After Slice 1, manually verify:

- signup/login;
- real DB row;
- persistence;
- cross-user denial;
- browser journey;
- migrations;
- Docker;
- CI.

### Gate C

Before release:

- clean clone;
- clean database;
- migrations;
- `npm run verify`;
- container startup;
- major journeys;
- independent final review;
- secrets/configuration check.

## Release conditions

Release requires:

```text
100% in-scope Must criteria pass
0 blocking review findings
0 fake-auth/fake-DB/mock-production findings
clean-clone verification succeeds
container packaging succeeds
major journeys pass manually
0 production TODO/mock/stub/fake paths
canonical seed/fixture data exists and is reproducible
```

The human owner makes the final release decision.

---

# 20. PROTECTING THE JUDGE

The Builder must not silently weaken verification.

Changes to these areas must be highlighted and reviewed:

```text
.github/workflows/**
package.json verification scripts
tests/invariants/**
playwright configuration
test-runner configuration
Docker verification
```

A small SaaS does not require a cryptographic audit ledger.

It does require visibility when the Builder changes the meaning of PASS.

---

# 21. SIMPLICITY AND DEPENDENCIES

Prefer:

- existing approved stack libraries;
- direct code;
- explicit behavior;
- small modules;
- conventional patterns.

A new dependency requires justification based on:

- correctness;
- security;
- maintenance;
- ecosystem maturity;
- actual reduction in complexity.

Do not rigidly implement every function under 50 LOC instead of using a mature library.

The correct rule is:

```text
avoid unnecessary dependencies,
but prefer a mature well-maintained library for security-sensitive or complex behavior
```

---

# 22. PROJECT-SPECIFIC RULE SELECTION

Do not blindly copy every rule into every project.

Examples:

- Idempotency is mandatory for external events, not for a static brochure page.
- Tenant-isolation tests are mandatory for multi-tenant products, not single-user local tools.
- Status endpoints are relevant for asynchronous jobs, not every CRUD route.
- Strict runtime invariant mode is optional unless the domain benefits from it.
- Capacitor requirements apply only when mobile packaging is requested.

The generated documents must stay concise and relevant.

---

# 23. FINAL SELF-CHECK BEFORE DELIVERING DESIGN DOCUMENTS

Before returning generated documents, verify:

## Product coverage

- Every Must requirement from the Product Book is preserved.
- Every major journey is mapped.
- Every role and permission is mapped.
- Every major failure path is represented.
- Non-goals are explicit.

## Architecture

- One coherent stack is selected.
- Modular monolith is used unless justified otherwise.
- Data ownership is explicit.
- Auth and authorization are separate.
- Transactions and idempotency are specified where needed.
- Deployment/container design is executable.

## Acceptance

- Every Must requirement has evidence.
- Major flows have E2E.
- Real DB use is proven.
- Authorization is tested directly.
- Container packaging is tested from a clean environment.
- 100% Must pass is required.

## Slices

- 4–7 vertical slices.
- Slice 1 proves trust foundation.
- Each slice has scope and non-goals.
- One slice can be implemented in one bounded session.
- No major requirement is unmapped.

## Prompts

- Claude prompts are one-slice-at-a-time.
- Codex prompts distinguish light, foundation, and final reviews.
- Repair is bounded.
- Reviewer normally does not fix its own findings.

## Simplicity

- No orchestrator is introduced.
- No machine state is stored in LLM-authored prose.
- No redundant governance documents are created.
- The final artifact set is small enough for agents to follow reliably.

---

# 24. FINAL DIRECTIVE

When this file and a Product Book are supplied, produce a concise, project-specific development package that is ready for:

```text
Claude Code implementation
→ Codex review
→ ordinary CI
→ human checkpoints
→ release
```

Preserve rigor where it prevents known failure modes:

- missing flows;
- fake database;
- missing auth/authorization;
- excessive bugs;
- Product Book drift;
- broken container packaging.

Remove rigor that creates a second product:

- custom orchestration;
- parsers;
- state machines;
- provider wrappers;
- audit bureaucracy.

The desired result is not a perfect process document.

The desired result is a working, fast, high-quality small-SaaS development process.
