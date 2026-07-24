# SCN-15 — Capacitor human device/simulator smoke (AC-051)

Concrete, reproducible procedure. Same web build as browser; no offline reasoning.
Record every Observable Result. Fail the scenario if any step diverges.

## Environment

| Item                 | Value                                                                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API + PostgreSQL     | `docker compose up -d postgres` then API on `http://localhost:8080` (or deployed HTTPS API that also serves the SPA)                                     |
| Auth                 | Better Auth **cookie sessions** only. Capacitor loads the SPA from the API origin (`CAPACITOR_SERVER_URL`) so cookies are same-origin. No bearer tokens. |
| Production allowlist | Set `VITE_PRODUCTION_API_ORIGINS=https://your-api.example` (comma-separated HTTPS origins). Selected `CAPACITOR_SERVER_URL` must exactly match.          |

### Exact build / run commands

**HTTP development (emulator/device → local API; cleartext allowed in Android debug only):**

```bash
# Android emulator → host machine API
export CAPACITOR_SERVER_URL=http://10.0.2.2:8080
# Physical device on LAN (replace with host LAN IP)
# export CAPACITOR_SERVER_URL=http://192.168.1.10:8080

npm run cap:dev --workspace @app/web
# or from apps/web after install:
#   CAPACITOR_SERVER_URL=http://10.0.2.2:8080 npm run cap:dev

npx cap run android   # debug build; cleartext permitted only in debug source set
# npx cap run ios
```

Root convenience scripts:

```bash
CAPACITOR_SERVER_URL=http://10.0.2.2:8080 npm run cap:dev
cd apps/web && npx cap run android
```

**Production / release packaging (HTTPS + allowlist; cleartext forbidden):**

```bash
export VITE_PRODUCTION_API_ORIGINS=https://api.example.com
export CAPACITOR_SERVER_URL=https://api.example.com
export CAPACITOR_PACKAGE_MODE=production
npm run cap:release --workspace @app/web
cd apps/web && npx cap run android --configuration release
# or: ./gradlew assembleRelease
```

| Mode        | Command                                               | HTTP cleartext                   |
| ----------- | ----------------------------------------------------- | -------------------------------- |
| Development | `npm run cap:dev` (+ `CAPACITOR_SERVER_URL=http://…`) | Yes — Android **debug** only     |
| Release     | `npm run cap:release` (+ HTTPS allowlisted URL)       | No — release/main deny cleartext |

Browser builds must not set `VITE_API_BASE_URL`. Prefer Capacitor `server.url` same-origin cookies over absolute API bases.

## Preconditions

1. Canonical fixtures seeded (`npm run db:seed`).
2. Fresh student account (or register in-app).
3. Network proxy/devtools available to drop one HTTP response (Charles, mitmproxy, or OS firewall after request leaves device).

---

## Procedure A — Server committed + response lost → reconcile on resume (no duplicate)

### Steps

1. Log in on device.
2. Start learning (EX-01). Confirm only chunk 0 is visible (`state_version = 0`).
3. Arm response loss: configure proxy to **allow the request to reach the API**, then **drop/abort the response body** for the first `POST /api/sessions/:id/actions`.
4. Assign token `ex01-c0-whole` → slot `WHOLE`.
5. Observe client: network/retry UI; **Retry same action** visible; UI `state_version` still `0`.
6. **Authoritative DB check** (before retry / after kill):

```sql
SELECT state_version,
       workspace_state->'slots' AS slots
FROM learning_sessions
WHERE id = '<session_id>';

SELECT client_action_id, outcome, state_version_after
FROM stage_attempts
WHERE session_id = '<session_id>'
ORDER BY sequence_no;
```

Expected: `learning_sessions.state_version = 1`, WHOLE occupied; exactly **one** `stage_attempts` row for that `client_action_id` with outcome `ACCEPTED`.

7. Force-stop the app or reload WebView; reopen / Resume session.
8. Observe: authoritative UI at `state_version = 1`; **pending action reconciled/cleared**; Retry **not** required for the already-committed action (no duplicate POST).
9. Same-tab path without reload: if response is lost and UI still shows Retry before resume, tap **Retry same action** — must reuse the original `client_action_id` (idempotent).

### Observable results (must all hold)

| Check                    | Expected                                                         |
| ------------------------ | ---------------------------------------------------------------- |
| First UI response        | Failure / retry affordance; no duplicate slot UI                 |
| DB after step 4–6        | One accepted attempt; session already at version 1               |
| After refresh/resume     | COMPLETED/advanced authoritative state; pending cleared          |
| Same-tab Retry (if used) | **Identical** `client_action_id` as first request                |
| DB after any retry       | Still **one** attempt row for that id; `state_version` unchanged |

**Pass criterion:** server applied the action once; client recovered via reconcile on resume and/or idempotent replay — never a second semantic apply.

---

## Procedure A2 — Final-answer lost response → COMPLETED reconcile

1. Reach final-answer controls on EX-01 (answer `12`).
2. Drop the response after `SUBMIT_FINAL_ANSWER` reaches the server.
3. Refresh / force-stop → Resume.
4. UI shows authoritative **COMPLETED**; pending final-answer action cleared; no stranded Retry; no duplicate attempt in DB.

---

## Procedure B — Conflict recovery

### Steps

1. From a healthy session at `state_version ≥ 1` with WHOLE filled, force the next Continue to send `expected_state_version: 0` (proxy rewrite) **or** submit a second action from a stale tab.
2. Observe conflict message and UI reload of authoritative state (WHOLE still filled; chunk 1 not revealed unless already earned).
3. DB: `state_version` unchanged by the conflicting request; no second advancement.

### Observable results

| Check | Expected                                         |
| ----- | ------------------------------------------------ |
| UI    | Conflict banner + authoritative workspace        |
| DB    | No extra state version bump for the stale action |

---

## Procedure C — Authoritative session verification after resume

### Steps

1. Complete a valid Whole assign; note `session_id` and `state_version`.
2. Background app 30s, or force-stop and relaunch; Resume session.
3. Compare UI to:

```sql
SELECT state_version, current_chunk_index, workspace_state, status
FROM learning_sessions WHERE id = '<session_id>';
```

### Observable results

UI `state_version`, visible chunks, and slot labels **equal** the SQL row. Client never invents validity.

---

## Record

| Platform | A lost-response+reconcile | A2 final-answer | B conflict | C resume=DB | Build mode (dev/release) | Pass/Fail | Tester | Date |
| -------- | ------------------------- | --------------- | ---------- | ----------- | ------------------------ | --------- | ------ | ---- |
| Android  |                           |                 |            |             |                          |           |        |      |
| iOS      |                           |                 |            |             |                          |           |        |      |

Owner sign-off: ______________________ Date: __________

**Note:** `ALLOW_IOS_SMOKE_SKIP=1` in verify is **not** SCN-15 evidence. This checklist is the AC-051 / Gate C proof.
