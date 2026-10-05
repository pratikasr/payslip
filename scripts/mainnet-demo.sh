#!/usr/bin/env bash
# Runs the six-contractor Payslip demo end to end against a running chain, and writes the
# proof (six shielded txids, heights, explorer links) plus statement CSVs.
#
# The same script is rehearsed on testnet:
#   scripts/mainnet-demo.sh scripts/demo/testnet-rehearsal.env
# and runs the recorded demo on mainnet:
#   cp scripts/demo/mainnet.env.example scripts/demo/mainnet.env   # fill it in
#   scripts/mainnet-demo.sh scripts/demo/mainnet.env
#
# What it does:
#   1. builds the service (release), creates the encrypted payer seed if none exists
#   2. starts the service with the config (or reuses one already serving that network)
#   3. onboards the six contractors (idempotent)
#   4. creates the run (idempotent: the key is derived from the config and contractor file)
#   5. funds it: testnet draws from the treasury at the fixed rate; mainnet asks 1Click for a
#      USDC deposit address and waits for the deposit (pay it from the web app's Fund step
#      or any wallet; set DEMO_DEPOSIT_TX to report the hash)
#   6. executes it and streams progress until every line is confirmed
#   7. writes scripts/demo/out/proof-<network>-<run>.md and the statement CSVs
#
# Mainnet spends real money: the script stops before funding unless run with --yes or
# confirmed interactively.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="${1:-}"
YES="${2:-}"
if [ -z "$CONFIG" ] || [ ! -f "$CONFIG" ]; then
  echo "usage: scripts/mainnet-demo.sh <config.env> [--yes]" >&2
  exit 2
fi
CONFIG="$(cd "$(dirname "$CONFIG")" && pwd)/$(basename "$CONFIG")"

# Secrets: the passphrase may live in the config (ignored by git) or in service/.env.
if [ -f "$ROOT/service/.env" ] && ! grep -q '^PAYSLIP_SEED_PASSPHRASE=.\+' "$CONFIG"; then
  PAYSLIP_SEED_PASSPHRASE="$(grep '^PAYSLIP_SEED_PASSPHRASE=' "$ROOT/service/.env" | head -1 | cut -d= -f2-)"
  export PAYSLIP_SEED_PASSPHRASE
fi
set -a
# shellcheck disable=SC1090
. "$CONFIG"
set +a
: "${ZCASH_NETWORK:?ZCASH_NETWORK must be set in $CONFIG}"
: "${PAYSLIP_SEED_PASSPHRASE:?set PAYSLIP_SEED_PASSPHRASE in $CONFIG or service/.env}"
BIND="${PAYSLIP_BIND:-127.0.0.1:8080}"
API="http://$BIND"
OUT="$ROOT/scripts/demo/out"
mkdir -p "$OUT"
START=$(date +%s)
stamp() { echo "[$(($(date +%s) - START))s] $*"; }

stamp "Building the service (release)"
(cd "$ROOT/service" && cargo build --release --quiet)
BIN="$ROOT/service/target/release/payslip-service"

cd "$ROOT/service"
DATA="${PAYSLIP_DATA_DIR:-./data/$ZCASH_NETWORK}"
if [ ! -f "$DATA/payer.seed.age" ]; then
  stamp "No payer seed in $DATA: creating one"
  "$BIN" init 2>/dev/null
fi

if curl -fsS "$API/api/health" >/dev/null 2>&1; then
  running_net=$(curl -fsS "$API/api/health" | python3 -c 'import json,sys; print(json.load(sys.stdin)["network"])')
  if [ "$running_net" != "$ZCASH_NETWORK" ]; then
    echo "A Payslip service on $API serves $running_net, not $ZCASH_NETWORK. Stop it or change PAYSLIP_BIND." >&2
    exit 1
  fi
  stamp "Reusing the $running_net service on $API"
else
  stamp "Starting the service on $API"
  nohup "$BIN" serve >"$OUT/service-$ZCASH_NETWORK.log" 2>&1 &
  for _ in $(seq 1 120); do
    curl -fsS "$API/api/health" >/dev/null 2>&1 && break
    sleep 1
  done
  curl -fsS "$API/api/health" >/dev/null || { echo "The service did not start; see $OUT/service-$ZCASH_NETWORK.log" >&2; exit 1; }
fi

DEV_ADDRESSES=""
if [ "${DEMO_GENERATED_WALLETS:-}" = "yes" ] || { [ "$ZCASH_NETWORK" = "testnet" ] && [ -z "${DEMO_CONTRACTORS_FILE:-}" ]; }; then
  ALLOW=""
  [ "$ZCASH_NETWORK" = "mainnet" ] && ALLOW="--allow-mainnet"
  DEV_ADDRESSES=$("$BIN" dev-contractors --count 6 $ALLOW 2>/dev/null | cut -f2 | tr '\n' ' ')
fi

export API ROOT OUT YES DEV_ADDRESSES START
python3 - <<'PY'
import hashlib, json, os, sys, time, urllib.error, urllib.request

API, ROOT, OUT = os.environ["API"], os.environ["ROOT"], os.environ["OUT"]
NET = os.environ["ZCASH_NETWORK"]
START = int(os.environ["START"])

def stamp(msg):
    print(f"[{int(time.time()) - START}s] {msg}", flush=True)

def call(method, path, body=None, raw=False, timeout=900):
    req = urllib.request.Request(API + path, method=method, headers={"content-type": "application/json"},
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = r.read()
            return r.status, (data if raw else json.loads(data))
    except urllib.error.HTTPError as e:
        payload = json.loads(e.read() or b"{}")
        err = payload.get("error", {})
        sys.exit(f"{method} {path} failed ({e.code}): {err.get('message')}\nFix: {err.get('hint')}")

cfile = os.environ.get("DEMO_CONTRACTORS_FILE") or ""
example = os.path.join(ROOT, "scripts/demo/contractors.example.json")
if not cfile and NET != "testnet":
    sys.exit("Set DEMO_CONTRACTORS_FILE in the config: start from scripts/demo/contractors.mainnet.example.json.")
spec = json.load(open(os.path.join(ROOT, cfile) if cfile else example))
people = spec["contractors"]
generated = os.environ.get("DEV_ADDRESSES", "").split()
for p, a in zip(people, generated):
    if not p.get("unified_address"):
        p["unified_address"] = a
for p in people:
    if p.get("payout_address") == "$DEMO_REFUND_ADDRESS":
        p["payout_address"] = os.environ.get("DEMO_REFUND_ADDRESS") or sys.exit(
            f"{p['name']} converts to USDC at DEMO_REFUND_ADDRESS; set it in the config.")
missing = [p["name"] for p in people if not p.get("unified_address")]
if missing:
    sys.exit(f"Missing unified_address for: {', '.join(missing)}")

health = call("GET", "/api/health")[1]
stamp(f"Service: {health['network']}, venue {health['venue']}, tip {health['chain_tip']}")

# 1. Contractors
existing = {c["unified_address"]: c for c in call("GET", "/api/contractors")[1]["contractors"]}
ids = []
for p in people:
    c = existing.get(p["unified_address"])
    if c is None:
        c = call("POST", "/api/contractors", {"name": p["name"], "email": p.get("email"), "unified_address": p["unified_address"],
                                             "settlement_choice": p.get("settlement_choice", "hold_zec"),
                                             "payout_chain": p.get("payout_chain"), "payout_address": p.get("payout_address")})[1]
        stamp(f"Onboarded {c['name']} on account {c['account_index']}")
    ids.append(c["id"])

# 2. Run (idempotent)
key = hashlib.sha256((NET + json.dumps(spec, sort_keys=True) + os.environ.get("DEMO_RUN_SALT", "")).encode()).hexdigest()[:32]
lines = [{"contractor_id": i, "amount_usd_cents": p["amount_usd_cents"], "invoice_ref": p["invoice_ref"]} for i, p in zip(ids, people)]
st, run = call("POST", "/api/runs", {"period_start": spec["period_start"], "period_end": spec["period_end"], "lines": lines, "idempotency_key": key})
rid = run["id"]
stamp(f"Run {rid} ({'created' if st == 201 else 'existing'}), status {run['status']}, payroll ${run['total_usd_cents']/100:,.2f}")

# 3. Fund
if run["status"] == "draft":
    if NET == "mainnet" and os.environ.get("YES") != "--yes":
        if not sys.stdin.isatty():
            sys.exit("Mainnet funding spends real money. Re-run with --yes to confirm.")
        if input("Mainnet: request a USDC deposit address for this run? Type yes: ").strip() != "yes":
            sys.exit("Stopped before funding.")
    run = call("POST", f"/api/runs/{rid}/fund", {"origin_chain": os.environ.get("DEMO_ORIGIN_CHAIN") or "base",
                                                 "refund_address": os.environ.get("DEMO_REFUND_ADDRESS") or None})[1]
f = run.get("funding") or {}
if run["status"] == "awaiting_funds":
    stamp(f"Deposit {f.get('amount_in')} USDC on {f.get('origin_chain')} (chain id {f.get('chain_id')}, token {f.get('token_address')}) to {f.get('deposit_address')} before {f.get('deadline')}")
    stamp("Pay it from the web app's Fund step or any wallet. Waiting for the venue.")
    tx = os.environ.get("DEMO_DEPOSIT_TX")
    if tx:
        call("POST", f"/api/runs/{rid}/funding/deposit-tx", {"tx_hash": tx})
    last = None
    while run["status"] == "awaiting_funds":
        time.sleep(10)
        run = call("GET", f"/api/runs/{rid}/funding")[1]
        s = (run.get("funding") or {}).get("venue_status")
        if s != last:
            stamp(f"Venue status: {s}")
            last = s
stamp(f"Funded: run status {run['status']}")

# 4. Execute and follow
call("POST", f"/api/runs/{rid}/execute")
seen = 0
t_exec = time.time()
while True:
    for e in call("GET", f"/api/runs/{rid}/log")[1]["events"]:
        if e["id"] > seen:
            seen = e["id"]
            stamp(e["message"])
    run = call("GET", f"/api/runs/{rid}")[1]
    if run["status"] in ("paid", "failed") and not run.get("executing"):
        break
    time.sleep(3)
if run["status"] != "paid":
    err = run.get("error") or {}
    sys.exit(f"Run failed: {err.get('message')}\nFix: {err.get('hint')}\nRe-run this script to resume.")
stamp(f"Paid in {int(time.time() - t_exec)}s from execute")

# 5. Proof and statements
fund = run.get("funding") or {}
md = [f"# Payslip {NET} demo run", "", f"- Run id: `{rid}`", f"- Period: {run['period_start']} to {run['period_end']}",
      f"- Venue: {fund.get('venue')}", f"- Funded: ${(fund.get('funded_usd_cents') or 0)/100:,.2f}",
      f"- ZEC acquired: {(fund.get('zec_acquired_zat') or 0)/1e8:.8f}",
      f"- Fill rate: ${(fund.get('rate_usd_per_zec_e6') or 0)/1e6:,.6f} per ZEC",
      f"- Allocation transaction: [{run['allocation_txid']}]({run.get('allocation_explorer_url')}) at height {run['allocation_height']}", "",
      "| Contractor | USD | ZEC | Txid | Height |", "| --- | ---: | ---: | --- | ---: |"]
for l in run["lines"]:
    md.append(f"| {l['contractor_name']} | {l['amount_usd_cents']/100:,.2f} | {l['amount_zat']/1e8:.8f} | [{l['txid']}]({l['explorer_url']}) | {l['confirmed_height']} |")
proof = os.path.join(OUT, f"proof-{NET}-{rid}.md")
open(proof, "w").write("\n".join(md) + "\n")
stamp(f"Proof written to {proof}")

keys = call("GET", "/api/viewing-keys")[1]["keys"]
first = next(k for k in keys if k["contractor_id"] == ids[0])
today = time.strftime("%Y-%m-%d", time.gmtime())
period = {"from": "2026-01-01", "to": today}
_, csv1 = call("POST", "/api/statements/contractor.csv", {"ufvk": first["ufvk"], **period}, raw=True)
open(os.path.join(OUT, f"statement-{NET}-{people[0]['name'].replace(' ', '-')}.csv"), "wb").write(csv1)
_, rec = call("POST", "/api/statements/accountant", {"ufvks": [k["ufvk"] for k in keys], **period})
_, csv2 = call("POST", "/api/statements/accountant.csv", {"ufvks": [k["ufvk"] for k in keys], **period}, raw=True)
open(os.path.join(OUT, f"reconciliation-{NET}.csv"), "wb").write(csv2)
mine = next((r for r in rec["runs"] if r["run_id"] == rid), None)
stamp(f"Accountant reconciliation for this run: {mine['status'] if mine else 'not found'}"
      + (f", variance ${mine['variance_usd_cents']/100:,.2f}, explained ${mine['explained_usd_cents']/100:,.2f}" if mine and mine.get('variance_usd_cents') is not None else ""))
print("\n".join(md))
if generated:
    print("\nThe contractors are generated demo wallets. After recording, return their ZEC to the treasury with:")
    print(f"  cd service && ./target/release/payslip-service dev-sweep{' --allow-mainnet' if NET == 'mainnet' else ''}")
PY
