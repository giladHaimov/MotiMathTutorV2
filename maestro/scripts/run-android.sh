#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WEB="$ROOT/apps/web"
ANDROID="$WEB/android"
APP_ID="com.reasoningtutor.app"
API_BASE="${API_BASE:-}"
HOST_API_BASE="${HOST_API_BASE:-}"

fail() {
  echo "mobile:delta: $*" >&2
  exit 1
}

[ -n "$API_BASE" ] || fail "API_BASE is required (the origin reachable from the Android device)"
command -v adb >/dev/null 2>&1 || fail "adb not found; install Android SDK platform-tools"
command -v maestro >/dev/null 2>&1 || fail "maestro not found; install it from https://docs.maestro.dev/getting-started/installing-maestro"
command -v node >/dev/null 2>&1 || fail "Node.js 20+ is required"

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
[ "$NODE_MAJOR" -ge 20 ] || fail "Node.js 20+ is required"

if [ -n "${ANDROID_SERIAL:-}" ]; then
  ADB=(adb -s "$ANDROID_SERIAL")
else
  DEVICES=()
  while IFS= read -r device; do
    DEVICES+=("$device")
  done < <(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')
  [ "${#DEVICES[@]}" -eq 1 ] || fail "expected exactly one ready adb device; set ANDROID_SERIAL when multiple are connected"
  ADB=(adb -s "${DEVICES[0]}")
fi
"${ADB[@]}" get-state >/dev/null 2>&1 || fail "selected adb device is not ready"

if [ -z "$HOST_API_BASE" ]; then
  HOST_API_BASE="${API_BASE/10.0.2.2/127.0.0.1}"
fi
export HOST_API_BASE

node "$ROOT/maestro/scripts/assert-session.mjs" --mode probe --api-base "$HOST_API_BASE"

echo "mobile:delta: building and syncing Capacitor for $API_BASE"
(
  cd "$WEB"
  VITE_CAPACITOR_SERVER_URL="$API_BASE" \
    VITE_CAPACITOR_HTTP_DEV=1 \
    CAPACITOR_PACKAGE_MODE=development \
    npm run build -- --mode development
  VITE_CAPACITOR_SERVER_URL="$API_BASE" \
    VITE_CAPACITOR_HTTP_DEV=1 \
    CAPACITOR_PACKAGE_MODE=development \
    npx cap sync android
)
(
  cd "$ANDROID"
  ./gradlew assembleDebug --no-daemon
)

APK="$ANDROID/app/build/outputs/apk/debug/app-debug.apk"
[ -f "$APK" ] || fail "debug APK not found at $APK"
"${ADB[@]}" install -r "$APK" >/dev/null || fail "failed to install $APK"
"${ADB[@]}" shell am force-stop "$APP_ID"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT_DIR="$ROOT/maestro/reports/$STAMP"
mkdir -p "$REPORT_DIR"
RUN_PASSWORD="$(node -e "process.stdout.write('M9!' + require('node:crypto').randomUUID())")"

run_flow() {
  local flow="$1"
  local label="$2"
  local email="maestro-${label}-${STAMP}@example.com"
  export TEST_EMAIL="$email"
  export TEST_PASSWORD="$RUN_PASSWORD"
  export TEST_NAME="Maestro ${label}"
  echo "mobile:delta: running $flow"
  maestro test \
    -e "TEST_EMAIL=$TEST_EMAIL" \
    -e "TEST_PASSWORD=$TEST_PASSWORD" \
    -e "TEST_NAME=$TEST_NAME" \
    --format junit \
    --output "$REPORT_DIR/$label.xml" \
    --test-output-dir "$REPORT_DIR/$label-artifacts" \
    --debug-output "$REPORT_DIR/$label-artifacts" \
    "$ROOT/maestro/flows/delta/$flow"
}

run_flow "boots-against-backend.yaml" "boot"
node "$ROOT/maestro/scripts/assert-session.mjs" --mode probe --api-base "$HOST_API_BASE"

run_flow "cookie-survives-restart.yaml" "cookie"
node "$ROOT/maestro/scripts/assert-session.mjs" \
  --api-base "$HOST_API_BASE" \
  --email "$TEST_EMAIL" \
  --password "$TEST_PASSWORD"

run_flow "resume-after-kill.yaml" "resume"
node "$ROOT/maestro/scripts/assert-session.mjs" \
  --api-base "$HOST_API_BASE" \
  --email "$TEST_EMAIL" \
  --password "$TEST_PASSWORD" \
  --state-version 1 \
  --visible-count 1 \
  --workspace "WHOLE=40 students"

TEST_EMAIL="maestro-lifecycle-${STAMP}@example.com"
TEST_PASSWORD="$RUN_PASSWORD"
TEST_NAME="Maestro lifecycle"
export TEST_EMAIL TEST_PASSWORD TEST_NAME
node "$ROOT/maestro/scripts/prepare-final-answer.mjs"
run_flow "keyboard-and-back.yaml" "lifecycle"
node "$ROOT/maestro/scripts/assert-session.mjs" \
  --api-base "$HOST_API_BASE" \
  --email "$TEST_EMAIL" \
  --password "$TEST_PASSWORD" \
  --state-version 5 \
  --visible-count 3 \
  --workspace "WHOLE=40 students,PART_IN_PERCENTAGE=30%,UNKNOWN=students who wear glasses" \
  --required-action "SUBMIT_FINAL_ANSWER"

echo "mobile:delta: PASS — reports at $REPORT_DIR"
