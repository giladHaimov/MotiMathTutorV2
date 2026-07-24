#!/usr/bin/env bash
#
# AC-047: Capacitor iOS project build smoke (clean sync + CocoaPods + xcodebuild).
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

echo "Building web assets and syncing Capacitor iOS (clean)"
npm run build --workspace @app/web
(cd "$WEB" && npx cap sync ios)

echo "CocoaPods install (must match package.json — no stale secure-storage pods)"
if ! command -v pod >/dev/null 2>&1; then
  echo "AC-047 FAIL: CocoaPods (pod) not found" >&2
  exit 1
fi
(cd "$IOS/App" && pod install)

if grep -qi 'aparajita\|secure-storage\|SecureStorage' "$IOS/App/Podfile" "$IOS/App/Podfile.lock"; then
  echo "AC-047 FAIL: stale Aparajita/secure-storage references remain in Podfile/Podfile.lock" >&2
  exit 1
fi

echo "Assert Debug ATS vs Release secure Info.plist separation"
DEBUG_PLIST="$IOS/App/App/Info-Debug.plist"
RELEASE_PLIST="$IOS/App/App/Info.plist"
if [ ! -f "$DEBUG_PLIST" ] || [ ! -f "$RELEASE_PLIST" ]; then
  echo "AC-047 FAIL: Info-Debug.plist / Info.plist missing" >&2
  exit 1
fi
if ! grep -q 'NSAppTransportSecurity' "$DEBUG_PLIST"; then
  echo "AC-047 FAIL: Info-Debug.plist must declare NSAppTransportSecurity for HTTP-dev" >&2
  exit 1
fi
if grep -q 'NSAppTransportSecurity' "$RELEASE_PLIST"; then
  echo "AC-047 FAIL: Release Info.plist must not relax ATS" >&2
  exit 1
fi
if ! grep -q 'Info-Debug.plist' "$IOS/App/App.xcodeproj/project.pbxproj"; then
  echo "AC-047 FAIL: Debug configuration must use Info-Debug.plist" >&2
  exit 1
fi

echo "xcodebuild Debug smoke (AC-047)"
(cd "$IOS/App" && xcodebuild \
  -workspace App.xcworkspace \
  -scheme App \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  build CODE_SIGNING_ALLOWED=NO)

echo "xcodebuild Release smoke (secure ATS defaults)"
(cd "$IOS/App" && xcodebuild \
  -workspace App.xcworkspace \
  -scheme App \
  -configuration Release \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  build CODE_SIGNING_ALLOWED=NO)

echo "iOS smoke OK"
