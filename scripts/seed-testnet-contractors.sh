#!/usr/bin/env bash
# Seeds the six demo contractors on a TESTNET Payslip service.
#
# Each contractor's receiving address comes from the separate dev contractor seed
# (`payslip-service dev-contractors`), which stands in for their own wallets on testnet.
# Idempotent: a contractor whose address is already registered is skipped.
#
# Usage: scripts/seed-testnet-contractors.sh <API_URL>   for example http://127.0.0.1:8080
# The URL is required: the script adds contractors to whichever service it names, so it never
# picks one by default.
set -euo pipefail

API="${1:-}"
if [ -z "$API" ]; then
  echo "usage: scripts/seed-testnet-contractors.sh <API_URL>   (the Payslip service to add the six contractors to)" >&2
  exit 2
fi
API="${API%/}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN="${PAYSLIP_BIN:-$ROOT/service/target/release/payslip-service}"
[ -x "$BIN" ] || BIN="$ROOT/service/target/debug/payslip-service"

network=$(curl -fsS "$API/api/health" | python3 -c 'import json,sys; print(json.load(sys.stdin)["network"])')
if [ "$network" != "testnet" ]; then
  echo "Refusing to seed: $API runs on $network, not testnet." >&2
  exit 1
fi
echo "Adding the six demo contractors to the testnet service on $API"

addresses=$(cd "$ROOT/service" && "$BIN" dev-contractors --count 6 2>/dev/null | cut -f2)

python3 - "$API" "$addresses" <<'PY'
import json, sys, urllib.request

api, addresses = sys.argv[1], sys.argv[2].split()
people = [
    ("Amara Okafor", "amara.okafor@example.com"),
    ("Mateo Fernandez", "mateo.fernandez@example.com"),
    ("Priya Raman", "priya.raman@example.com"),
    ("Jonas Lindqvist", "jonas.lindqvist@example.com"),
    ("Mei Chen", "mei.chen@example.com"),
    ("Kwame Mensah", "kwame.mensah@example.com"),
]

def call(method, path, body=None):
    req = urllib.request.Request(api + path, method=method, headers={"content-type": "application/json"},
                                 data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req) as r:
        return json.load(r)

existing = {c["unified_address"] for c in call("GET", "/api/contractors")["contractors"]}
for (name, email), addr in zip(people, addresses):
    if addr in existing:
        print(f"skip   {name} (already registered)")
        continue
    c = call("POST", "/api/contractors", {"name": name, "email": email, "unified_address": addr, "settlement_choice": "hold_zec"})
    print(f"added  {name} -> account {c['account_index']}")
PY
