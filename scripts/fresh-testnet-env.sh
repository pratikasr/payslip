#!/usr/bin/env bash
# Creates a clean TESTNET data directory (empty payslip.db and wallet.db) that reuses the
# existing encrypted payer seed and dev contractor seed, so the treasury keeps its faucet funds.
# Used by the end-to-end test and the demo rehearsals, which must start from a clean database.
#
# Usage: scripts/fresh-testnet-env.sh <name>        creates service/data/<name>
# Then:  cd service && PAYSLIP_DATA_DIR=./data/<name> PAYSLIP_BIRTHDAY_HEIGHT=<treasury birthday> \
#          ./target/release/payslip-service serve
# Stop any other service that uses the same seed first: two wallets spending one seed conflict.
set -euo pipefail
NAME="${1:?usage: scripts/fresh-testnet-env.sh <name>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/service/data/testnet"
DST="$ROOT/service/data/$NAME"
[ -f "$SRC/payer.seed.age" ] || { echo "No testnet seed in $SRC; run payslip-service init first." >&2; exit 1; }
if [ -e "$DST" ]; then
  echo "$DST exists; remove it first for a clean database." >&2
  exit 1
fi
mkdir -p "$DST"
cp "$SRC/payer.seed.age" "$DST/"
[ -f "$SRC/dev-contractors.seed.age" ] && cp "$SRC/dev-contractors.seed.age" "$DST/"
chmod 600 "$DST"/*.age
echo "PAYSLIP_DATA_DIR=./data/$NAME"
