#!/usr/bin/env bash
#
# Full verification gate (ACCEPTANCE.md §2). Runs the fast gate, real-PostgreSQL
# integration tests, clean migration + seed, Playwright E2E against the real API,
# a production web build, and a Docker container build + smoke + restart check.
#
set -euo pipefail

export DATABASE_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5439/reasoning_tutor}"
export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-verify-only-secret-please-change-32chars}"
export BETTER_AUTH_URL="${BETTER_AUTH_URL:-http://localhost:8080}"
export TRUSTED_ORIGINS="${TRUSTED_ORIGINS:-http://localhost:8080}"
export ENGINE_VERSION="${ENGINE_VERSION:-1.0.0}"

BASE=http://localhost:8080

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

wait_for_pg() {
  log "Waiting for PostgreSQL to be healthy"
  for _ in $(seq 1 30); do
    if [ "$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose ps -q postgres)" 2>/dev/null)" = "healthy" ]; then
      echo "postgres healthy"; return 0
    fi
    sleep 2
  done
  echo "postgres did not become healthy" >&2; exit 1
}

wait_for_health() {
  log "Waiting for $BASE/health"
  for _ in $(seq 1 30); do
    if curl -fs "$BASE/health" >/dev/null 2>&1; then echo "app healthy"; return 0; fi
    sleep 2
  done
  echo "app did not become healthy" >&2; exit 1
}

# 1. Fast gate: format, lint, typecheck, unit tests.
log "Fast gate: npm run check"
npm run check

# 2. Real PostgreSQL.
log "Starting PostgreSQL"
docker compose up -d postgres
wait_for_pg

# 3. Clean migration from empty DB + canonical seed import.
log "Migrations + canonical seed"
npm run db:migrate
npm run db:seed

# 4. Integration + invariant tests against real PostgreSQL.
log "Integration + invariant tests"
npm run test:integration

# 5. Long, stateful real-PostgreSQL user journeys (kept out of the fast gate).
log "Long-running backend scenario catalog"
npm run test:scenarios

# 6. Realistic Playwright scenarios against the real API + DB (builds the web SPA).
log "Playwright E2E"
npm run test:e2e

# 7. Production web build (explicit).
log "Production build"
npm run build

# 8. Capacitor packaging smoke (AC-046 / AC-047).
log "Capacitor Android smoke (AC-046)"
bash scripts/capacitor-android-smoke.sh

log "Capacitor iOS smoke (AC-047)"
# Default fails without Xcode. Local/CI hosts without Xcode must set
# ALLOW_IOS_SMOKE_SKIP=1 explicitly — that is a documented skip, never a PASS.
bash scripts/capacitor-ios-smoke.sh

# 9. Container build + smoke + restart persistence.
log "Docker image build (no cache)"
docker compose build --no-cache app

log "Container migrate + seed (in-container, no host deps)"
docker compose run --rm app npm run db:migrate
docker compose run --rm app npm run db:seed

log "Starting app container"
docker compose up -d app
wait_for_health

log "Container smoke: register -> start -> action -> restart -> resume"
JAR=$(mktemp)
CAID=$(node -e "console.log(crypto.randomUUID())")
EMAIL="verify-$(date +%s)@example.com"
curl -fs -c "$JAR" -b "$JAR" -X POST "$BASE/api/auth/sign-up/email" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"Passw0rd!123\",\"name\":\"Verify\"}" >/dev/null
SESSION_JSON=$(curl -fs -c "$JAR" -b "$JAR" -X POST "$BASE/api/sessions")
SID=$(node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).session_id))" <<<"$SESSION_JSON")
TOKEN=$(node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).visible_chunks[0].tokens[0].token_id))" <<<"$SESSION_JSON")
curl -fs -c "$JAR" -b "$JAR" -X POST "$BASE/api/sessions/$SID/actions" \
  -H 'content-type: application/json' \
  -d "{\"client_action_id\":\"$CAID\",\"expected_state_version\":0,\"action_type\":\"ASSIGN_SLOT\",\"payload\":{\"slot\":\"WHOLE\",\"token_id\":\"$TOKEN\"}}" >/dev/null

log "Restarting app container (AC-057)"
docker compose restart app
wait_for_health
RESUMED=$(curl -fs -c "$JAR" -b "$JAR" "$BASE/api/sessions/$SID")
STATE=$(node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).state_version))" <<<"$RESUMED")
if [ "$STATE" != "1" ]; then
  echo "container restart did not preserve session state (state_version=$STATE)" >&2
  docker compose logs app >&2 || true
  docker compose down -v
  exit 1
fi
echo "container restart preserved session state (state_version=$STATE)"

log "Tearing down"
docker compose down -v

log "VERIFY PASSED"
