# SCN-15 — Human device / simulator smoke (AC-051)

Run on Android emulator/device and on iOS simulator when Xcode is available.
Uses the same web build packaged by Capacitor — no offline reasoning.

## Steps

1. Start API + PostgreSQL (`docker compose up` / local `npm run dev`).
2. Set `VITE_API_BASE_URL` to the reachable API origin for the device/emulator
   (Android emulator example: `http://10.0.2.2:8080`), rebuild, `npx cap sync`.
3. Launch the app (`npx cap run android` / `npx cap run ios`).
4. Register or log in.
5. Start a problem session; confirm only the first chunk is visible.
6. Assign a slot; confirm the workspace updates from the server response.
7. Simulate temporary network loss (airplane mode / disable network):
   - Submit an action that appears to fail.
   - Re-enable network and tap **Retry same action**.
   - Confirm state advances once (no duplicate assignment).
8. Background the app, then resume; confirm the same reveal/workspace state.
9. Delete a conflicting assignment when instructed; confirm no silent auto-correct.
10. Log out; confirm protected APIs are rejected.

## Record

| Platform | Build OK | Login | Action | Retry | Resume | Pass/Fail | Notes |
| -------- | -------- | ----- | ------ | ----- | ------ | --------- | ----- |
| Android  |          |       |        |       |        |           |       |
| iOS      |          |       |        |       |        |           |       |

Owner sign-off: ______________________ Date: __________
