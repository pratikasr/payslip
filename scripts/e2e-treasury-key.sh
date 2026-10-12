#!/usr/bin/env bash
# Runs the treasury key browser tests (web/e2e/treasury-key.spec.ts) against a service and a web
# app of their own, so nothing on the usual ports is touched: the service starts with NO seed
# file and no PAYSLIP_SEED_PASSPHRASE (the first admin creates the key from the browser), with
# PAYSLIP_AUTH=required, and the web app with the email-and-password test login on.
#
# Usage: scripts/e2e-treasury-key.sh            builds the service (debug) and the web app, then tests
#        E2E_TREASURY_SKIP_BUILD=1 scripts/e2e-treasury-key.sh   reuses the last builds
#
# Settings (all optional): E2E_TREASURY_DIR (data, default /tmp/payslip-e2e-treasury-key),
# E2E_TREASURY_SERVICE_PORT (8097), E2E_TREASURY_WEB_PORT (3322), PAYSLIP_BIN (service binary).
# Needs Node 22.16 or newer (auth.db is kept through node:sqlite), Chromium for Playwright
# (cd web && pnpm exec playwright install chromium) and access to testnet.zec.rocks.
#
# On a service from before the key was managed from the console (health without `treasury`),
# the suite skips itself; such a service may not even start without a seed, which this script
# reports as "The service did not start".
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${E2E_TREASURY_DIR:-/tmp/payslip-e2e-treasury-key}"
SVC_PORT="${E2E_TREASURY_SERVICE_PORT:-8097}"
WEB_PORT="${E2E_TREASURY_WEB_PORT:-3322}"
BIN="${PAYSLIP_BIN:-$ROOT/service/target/debug/payslip-service}"
ADMIN_EMAIL="owner@example.test"
WEB_URL="http://127.0.0.1:$WEB_PORT"
SVC_URL="http://127.0.0.1:$SVC_PORT"
mkdir -p "$DIR/service"
chmod 700 "$DIR"

if [ ! -f "$DIR/auth-secret" ]; then
  openssl rand -base64 32 > "$DIR/auth-secret"
  chmod 600 "$DIR/auth-secret"
fi

if [ "${E2E_TREASURY_SKIP_BUILD:-0}" != "1" ]; then
  (cd "$ROOT/service" && cargo build)
fi

# Service environment. Explicit variables win over service/.env, which may hold another wallet.
# No seed and no passphrase: the key is created from the browser.
export ZCASH_NETWORK=testnet
export PAYSLIP_DATA_DIR="$DIR/service"
export PAYSLIP_BIND="127.0.0.1:$SVC_PORT"
export PAYSLIP_WEB_ORIGIN="$WEB_URL"
export PAYSLIP_AUTH=required
export PAYSLIP_AUTH_JWKS_URL="$WEB_URL/api/auth/jwks"
export PAYSLIP_BOOTSTRAP_ADMIN_EMAIL="$ADMIN_EMAIL"
export PAYSLIP_PRICE_API_URL=off
export PAYSLIP_MIN_CONFIRMATIONS=1
# Exported empty rather than unset: the service loads service/.env for variables that are absent,
# and an empty value counts as not set.
export PAYSLIP_SEED_PASSPHRASE=

# Every run starts from nothing: no seed, no wallet, empty app and auth databases.
rm -rf "$DIR/service"
mkdir -p "$DIR/service"
rm -f "$DIR/auth.db" "$DIR/auth.db-wal" "$DIR/auth.db-shm"

cleanup() {
  # Each server is started with exec, so its PID is the server's own, and each runs in its own
  # process group (the web server forks next-server), so the whole group is stopped.
  for pid in "${WEB_PID:-}" "${SVC_PID:-}"; do
    [ -n "$pid" ] || continue
    kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT

for port in "$SVC_PORT" "$WEB_PORT"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN > /dev/null 2>&1; then
    echo "Port $port is in use; stop what listens there or set E2E_TREASURY_SERVICE_PORT / E2E_TREASURY_WEB_PORT." >&2
    exit 1
  fi
done

set -m
(cd "$ROOT/service" && exec "$BIN" serve > "$DIR/service.log" 2>&1) &
SVC_PID=$!
for _ in $(seq 1 60); do
  curl -sf "$SVC_URL/api/health" > /dev/null && break
  sleep 1
done
curl -sf "$SVC_URL/api/health" > /dev/null || { echo "The service did not start (a service that needs a seed file cannot run this suite); see $DIR/service.log" >&2; exit 1; }

# Web environment. These are read at build time too (static pages), so the build gets them.
export PAYSLIP_AUTH_TEST_LOGIN=1
export BETTER_AUTH_URL="$WEB_URL"
export PAYSLIP_API_INTERNAL_URL="$SVC_URL"
export NEXT_PUBLIC_PAYSLIP_API_URL="$SVC_URL"
export PAYSLIP_AUTH_DB="$DIR/auth.db"
BETTER_AUTH_SECRET="$(cat "$DIR/auth-secret")"
export BETTER_AUTH_SECRET
unset GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET PAYSLIP_GOOGLE_WORKSPACE_DOMAIN

if [ "${E2E_TREASURY_SKIP_BUILD:-0}" != "1" ]; then
  (cd "$ROOT/web" && pnpm build > "$DIR/web-build.log" 2>&1) || { echo "The web build failed; see $DIR/web-build.log" >&2; exit 1; }
fi
(cd "$ROOT/web" && exec pnpm start -p "$WEB_PORT" > "$DIR/web.log" 2>&1) &
WEB_PID=$!
set +m
for _ in $(seq 1 60); do
  curl -sf "$WEB_URL/sign-in" > /dev/null && break
  sleep 1
done
curl -sf "$WEB_URL/sign-in" > /dev/null || { echo "The web app did not start; see $DIR/web.log" >&2; exit 1; }

cd "$ROOT/web"
E2E_TREASURY=1 E2E_BASE_URL="$WEB_URL" E2E_API_URL="$SVC_URL" E2E_AUTH_ADMIN_EMAIL="$ADMIN_EMAIL" \
  pnpm exec playwright test e2e/treasury-key.spec.ts "$@"
