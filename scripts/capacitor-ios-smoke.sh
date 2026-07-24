#!/usr/bin/env bash
#
# AC-047: Capacitor iOS project build smoke.
#
# Default: FAIL when full Xcode / xcodebuild is unavailable — never a silent PASS.
# Skip is allowed ONLY when explicitly configured for a development environment:
#   ALLOW_IOS_SMOKE_SKIP=1
# and only when VERIFY_REQUIRE_IOS is not set to 1.
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/apps/web"
IOS="$WEB/ios"

if [ ! -d "$IOS" ]; then
  echo "AC-047 FAIL: iOS platform missing at $IOS — run: npx cap add ios (from apps/web)" >&2
  exit 1
fi

if ! xcodebuild -version >/dev/null 2>&1; then
  if [ "${VERIFY_REQUIRE_IOS:-0}" = "1" ]; then
    echo "AC-047 FAIL: VERIFY_REQUIRE_IOS=1 but xcodebuild is unavailable." >&2
    exit 1
  fi
  if [ "${ALLOW_IOS_SMOKE_SKIP:-0}" = "1" ]; then
    echo "AC-047 SKIP (explicit): ALLOW_IOS_SMOKE_SKIP=1 and xcodebuild unavailable."
    echo "This is not a PASS — iOS build was not validated. Do not treat as release evidence."
    exit 0
  fi
  echo "AC-047 FAIL: full Xcode not available (xcodebuild missing)." >&2
  echo "Install Xcode, or set ALLOW_IOS_SMOKE_SKIP=1 only in an explicit development environment." >&2
  exit 1
fi

if [ ! -f "$IOS/App/App.xcworkspace/contents.xcworkspacedata" ] && [ ! -f "$IOS/App/Podfile" ]; then
  echo "AC-047 FAIL: iOS project scaffolding incomplete" >&2
  exit 1
fi

echo "Building web assets and syncing Capacitor iOS"
npm run build --workspace @app/web
(cd "$WEB" && npx cap sync ios)

echo "xcodebuild smoke (AC-047)"
(cd "$IOS/App" && xcodebuild \
  -workspace App.xcworkspace \
  -scheme App \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  build CODE_SIGNING_ALLOWED=NO)

echo "iOS smoke OK"
