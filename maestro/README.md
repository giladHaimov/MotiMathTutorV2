# Maestro Web→Mobile Delta

This suite tests only behavior unique to the packaged Capacitor Android app. It
does not repeat the Playwright reasoning journeys.

## Prerequisites

- Node.js 20 or newer and repository dependencies installed
- a running real API/PostgreSQL environment with migrations and canonical seed data
- Android SDK/JDK and exactly one ready emulator/device in `adb devices`
- [Maestro installed separately](https://docs.maestro.dev/getting-started/installing-maestro)

For an Android emulator, expose the API to the app with `10.0.2.2` and keep the
host-side checkpoint URL on `127.0.0.1`:

```bash
API_BASE=http://10.0.2.2:8080 \
HOST_API_BASE=http://127.0.0.1:8080 \
pnpm mobile:delta
```

`API_BASE` must be the origin reachable from the Android device. `HOST_API_BASE`
must identify the same backend from the host; it defaults to `API_BASE` with
`10.0.2.2` translated to `127.0.0.1`.

The runner fails closed when the backend, device, tools, build, install, Maestro
flow, or server checkpoint fails. It reuses the existing `cap:dev` sync script,
builds and installs the debug APK, and writes JUnit reports, Maestro logs, and
screenshots under `maestro/reports/<timestamp>/`.

## Coverage

- `boots-against-backend.yaml`: packaged `server.url`, debug cleartext wiring,
  auth view, and a real backend/auth request (AC-001, AC-046).
- `cookie-survives-restart.yaml`: Better Auth cookie survives `stopApp` plus cold
  `launchApp`; the helper separately proves the same test account has a valid
  server-side cookie session (AC-001, AC-049).
- `resume-after-kill.yaml`: one accepted assignment, process death, and exact
  authoritative state resume (`state_version`, visible reveal set, workspace)
  through the real API (AC-049).
- `keyboard-and-back.yaml`: an API-only fixture advances the real session to the
  final-answer stage, then Maestro checks keyboard dismissal and Android Back
  without submitting an answer; the final API assertion proves the session was
  not corrupted (AC-049 and the native-lifecycle subset of AC-051).

`prepare-final-answer.mjs` uses only Better Auth and public application APIs. It
does not mock services, write PostgreSQL directly, or place reasoning logic in
the client. `assert-session.mjs` keeps the Better Auth test cookie in memory and
uses it for protected server checkpoints.

This environmental suite is intentionally separate from the blocking
`npm run verify` gate and does not replace the existing human SCN-15 smoke.
