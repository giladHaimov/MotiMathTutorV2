# SCN-15 — Capacitor human device/simulator smoke (AC-051)

Concrete, reproducible procedure. Same web build as browser; no offline reasoning.
Record every Observable Result. Fail the scenario if any step diverges.

## Environment

| Item              | Value                                                                                                                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API + PostgreSQL  | `docker compose up -d postgres` then API on `http://localhost:8080` (or deployed HTTPS API)                                                                                        |
| Native API origin | **Development/test only:** `VITE_API_BASE_URL=http://10.0.2.2:8080` (Android emulator → host). **Production native:** `https://…` only. Browser builds must not set this variable. |
| Build             | `VITE_API_BASE_URL=… npm run build --workspace @app/web && (cd apps/web && npx cap sync)`                                                                                          |
| Launch            | `npx cap run android` / `npx cap run ios`                                                                                                                                          |
| DB inspection     | `psql "$DATABASE_URL"` (or Docker exec into postgres)                                                                                                                              |

## Preconditions

1. Canonical fixtures seeded (`npm run db:seed`).
2. Fresh student account (or register in-app).
3. Network proxy/devtools available to drop one HTTP response (Charles, mitmproxy, or OS firewall after request leaves device).

---

## Procedure A — Server committed + response lost → exactly-once replay

### Steps

1. Log in on device.
2. Start learning (EX-01). Confirm only chunk 0 is visible (`state_version = 0`).
3. Arm response loss: configure proxy to **allow the request to reach the API**, then **drop/abort the response body** for the first `POST /api/sessions/:id/actions`.
4. Assign token `ex01-c0-whole` → slot `WHOLE`.
5. Observe client: network/retry UI; **Retry same action** visible; UI `state_version` still `0`.
6. **Authoritative DB check** (before retry):

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

7. Optional kill/resume: force-stop the app or reload WebView; reopen session. Confirm **Retry** still offered and `pending-action-id` / stored pending matches the same UUID.
8. Tap **Retry same action** (network healthy).
9. Observe client: `state_version = 1`, slot label `40 students`, Retry gone.

### Observable results (must all hold)

| Check              | Expected                                                         |
| ------------------ | ---------------------------------------------------------------- |
| First UI response  | Failure / retry affordance; no duplicate slot UI                 |
| DB after step 4–6  | One accepted attempt; session already at version 1               |
| Retry request body | **Identical** `client_action_id` as first request                |
| DB after retry     | Still **one** attempt row for that id; `state_version` remains 1 |
| UI after retry     | Matches DB (WHOLE = 40 students)                                 |

**Pass criterion:** server applied the action once; client recovered via idempotent replay after lost response and after refresh/restart.

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

| Platform | A lost-response+retry | A after app restart | B conflict | C resume=DB | Build | Pass/Fail | Tester | Date |
| -------- | --------------------- | ------------------- | ---------- | ----------- | ----- | --------- | ------ | ---- |
| Android  |                       |                     |            |             |       |           |        |      |
| iOS      |                       |                     |            |             |       |           |        |      |

Owner sign-off: ______________________ Date: __________

**Note:** `ALLOW_IOS_SMOKE_SKIP=1` in verify is **not** SCN-15 evidence. This checklist is the AC-051 / Gate C proof.
