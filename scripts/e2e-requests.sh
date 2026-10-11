#!/usr/bin/env bash
# Runs the payment request and pay schedule browser tests (web/e2e/requests.spec.ts) against a
# service and a web app of their own, so nothing on the usual ports is touched: a throwaway
# testnet wallet with no funds (nothing is funded or paid), the service with sign-in off, and the
# web app pointed at it.
#
# Usage: scripts/e2e-requests.sh            builds the service (debug) and the web app, then tests
#        E2E_REQUESTS_SKIP_BUILD=1 scripts/e2e-requests.sh   reuses the last builds
#
# Settings (all optional): E2E_REQUESTS_DIR (data, default /tmp/payslip-e2e-requests),
# E2E_REQUESTS_SERVICE_PORT (8093), E2E_REQUESTS_WEB_PORT (3313), PAYSLIP_BIN (service binary).
# Needs Chromium for Playwright (cd web && pnpm exec playwright install chromium) and access to
# testnet.zec.rocks (the service reads the chain tip when it opens an account).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${E2E_REQUESTS_DIR:-/tmp/payslip-e2e-requests}"
SVC_PORT="${E2E_REQUESTS_SERVICE_PORT:-8093}"
WEB_PORT="${E2E_REQUESTS_WEB_PORT:-3313}"
BIN="${PAYSLIP_BIN:-$ROOT/service/target/debug/payslip-service}"
WEB_URL="http://127.0.0.1:$WEB_PORT"
SVC_URL="http://127.0.0.1:$SVC_PORT"
mkdir -p "$DIR/service"
chmod 700 "$DIR"

# The throwaway wallet's passphrase, kept with it so a rerun can unlock the same seed.
if [ ! -f "$DIR/passphrase" ]; then
  openssl rand -hex 16 > "$DIR/passphrase"
  chmod 600 "$DIR/passphrase"
fi

if [ "${E2E_REQUESTS_SKIP_BUILD:-0}" != "1" ]; then
  (cd "$ROOT/service" && cargo build)
fi

# Service environment. Explicit variables win over service/.env, which may hold another wallet.
export ZCASH_NETWORK=testnet
export PAYSLIP_DATA_DIR="$DIR/service"
export PAYSLIP_BIND="127.0.0.1:$SVC_PORT"
export PAYSLIP_WEB_ORIGIN="$WEB_URL"
export PAYSLIP_PRICE_API_URL=off
export PAYSLIP_MIN_CONFIRMATIONS=1
export PAYSLIP_AUTH=off
unset PAYSLIP_AUTH_JWKS_URL PAYSLIP_BOOTSTRAP_ADMIN_EMAIL PAYSLIP_MODE
PAYSLIP_SEED_PASSPHRASE="$(cat "$DIR/passphrase")"
export PAYSLIP_SEED_PASSPHRASE

if [ ! -f "$DIR/service/payer.seed.age" ]; then
  echo "Creating the throwaway testnet wallet in $DIR/service"
  (cd "$ROOT/service" && "$BIN" init > /dev/null)
fi
# Every run starts from an empty app database (the wallet and its seed are kept).
rm -f "$DIR/service/payslip.db" "$DIR/service/payslip.db-wal" "$DIR/service/payslip.db-shm"
# Two demo contractor addresses, from the dev seed beside the wallet.
ADDRESSES="$(cd "$ROOT/service" && "$BIN" dev-contractors --count 2 | cut -f2 | paste -sd, -)"

cleanup() {
  for pid in "${WEB_PID:-}" "${SVC_PID:-}"; do
    [ -n "$pid" ] || continue
    kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
}
trap cleanup EXIT

for port in "$SVC_PORT" "$WEB_PORT"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN > /dev/null 2>&1; then
    echo "Port $port is in use; stop what listens there or set E2E_REQUESTS_SERVICE_PORT / E2E_REQUESTS_WEB_PORT." >&2
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
curl -sf "$SVC_URL/api/health" > /dev/null || { echo "The service did not start; see $DIR/service.log" >&2; exit 1; }

# Web environment, read at build time too.
export PAYSLIP_API_INTERNAL_URL="$SVC_URL"
export NEXT_PUBLIC_PAYSLIP_API_URL="$SVC_URL"
unset PAYSLIP_AUTH_TEST_LOGIN BETTER_AUTH_URL

if [ "${E2E_REQUESTS_SKIP_BUILD:-0}" != "1" ]; then
  (cd "$ROOT/web" && pnpm build > "$DIR/web-build.log" 2>&1) || { echo "The web build failed; see $DIR/web-build.log" >&2; exit 1; }
fi
(cd "$ROOT/web" && exec pnpm start -p "$WEB_PORT" > "$DIR/web.log" 2>&1) &
WEB_PID=$!
set +m
for _ in $(seq 1 60); do
  curl -sf "$WEB_URL/portal" > /dev/null && break
  sleep 1
done
curl -sf "$WEB_URL/portal" > /dev/null || { echo "The web app did not start; see $DIR/web.log" >&2; exit 1; }

cd "$ROOT/web"
E2E_BASE_URL="$WEB_URL" E2E_API_URL="$SVC_URL" E2E_CONTRACTOR_ADDRESSES="$ADDRESSES" \
  pnpm exec playwright test e2e/requests.spec.ts "$@"
