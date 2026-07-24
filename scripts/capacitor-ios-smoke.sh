#!/usr/bin/env bash
#
# AC-047: Capacitor iOS project builds when a full Xcode environment is available.
# When only Command Line Tools are present (no xcodebuild), the check is skipped
# with an explicit message — Gate C / SCN-15 still require human simulator smoke
# on a machine with Xcode.
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEB="$ROOT/apps/web"
IOS="$WEB/ios"

if [ ! -d "$IOS" ]; then
  echo "iOS platform missing at $IOS — run: npx cap add ios (from apps/web)" >&2
  exit 1
fi

if ! xcodebuild -version >/dev/null 2>&1; then
  echo "AC-047 SKIP: full Xcode not available (xcodebuild missing)."
  echo "iOS project is scaffolded under apps/web/ios; run human SCN-15 when Xcode is present."
  exit 0
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
