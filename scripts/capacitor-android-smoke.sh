#!/usr/bin/env bash
#
# AC-046: Capacitor Android project builds (assembleDebug smoke).
# Requires Android SDK + JDK. Fails hard when SDK is present but the build fails.
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/apps/web"
ANDROID="$WEB/android"

if [ ! -d "$ANDROID" ]; then
  echo "Android platform missing at $ANDROID — run: npm run cap:sync --workspace @app/web" >&2
  exit 1
fi

if [ -z "${ANDROID_HOME:-}${ANDROID_SDK_ROOT:-}" ] && [ ! -d "$HOME/Library/Android/sdk" ]; then
  echo "ANDROID_HOME/ANDROID_SDK_ROOT not set and default SDK path missing — cannot smoke Android." >&2
  exit 1
fi

export ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"

echo "Building web assets and syncing Capacitor Android"
npm run build --workspace @app/web
(cd "$WEB" && npx cap sync android)

echo "Gradle assembleDebug (AC-046)"
(cd "$ANDROID" && ./gradlew assembleDebug --no-daemon)

APK=$(find "$ANDROID/app/build/outputs/apk/debug" -name '*.apk' 2>/dev/null | head -1 || true)
if [ -z "$APK" ]; then
  echo "assembleDebug succeeded but no APK found" >&2
  exit 1
fi
echo "Android smoke OK: $APK"
