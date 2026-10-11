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
#   2. starts the service with the config, or reuses one already on PAYSLIP_BIND only when it
#      serves the same network and the same treasury as the seed in PAYSLIP_DATA_DIR
#   3. onboards the six contractors (idempotent)
#   4. creates the run (idempotent: the key is derived from the config and contractor file)
#   5. funds it: testnet draws from the treasury at the fixed rate; mainnet asks 1Click for a
#      USDC deposit address and waits for the deposit (pay it from the web app's Fund step
#      or any wallet; set DEMO_DEPOSIT_TX to report the hash). With DEMO_FUNDING=zec the run
#      is funded with ZEC instead (ADR-025): the script prints the treasury address and the
#      ZEC to send, and polls until the treasury's confirmed balance covers the run at the
#      market rate of that block. On testnet this draws faucet coins at the market rate.
#   6. executes it and streams progress until every line is confirmed
#   7. writes scripts/demo/out/proof-<network>-<run>.md, the statement CSVs and a judge kit
#      (judge-kit-<network>.json: every viewing key plus one payment proof)
#
# Mainnet spends real money: the script stops before funding unless run with --yes or
# confirmed interactively. On mainnet the seed passphrase must be in the config file; the
# script never reuses the testnet passphrase from service/.env. Back up the encrypted seed
# (<PAYSLIP_DATA_DIR>/payer.seed.age) and its passphrase before funding.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="${1:-}"
YES="${2:-}"
if [ -z "$CONFIG" ] || [ ! -f "$CONFIG" ]; then
  echo "usage: scripts/mainnet-demo.sh <config.env> [--yes]" >&2
  exit 2
fi
CONFIG="$(cd "$(dirname "$CONFIG")" && pwd)/$(basename "$CONFIG")"

set -a
# shellcheck disable=SC1090
. "$CONFIG"
set +a
: "${ZCASH_NETWORK:?ZCASH_NETWORK must be set in $CONFIG}"

# The service also reads service/.env for anything left unset, and that file holds the testnet
# settings. Off testnet, the config must name its own data folder, port and lightwalletd.
if [ "$ZCASH_NETWORK" != "testnet" ]; then
  for var in PAYSLIP_DATA_DIR PAYSLIP_BIND LIGHTWALLETD_URL; do
    if ! grep -Eq "^$var=.+" "$CONFIG"; then
      echo "Set $var in $CONFIG. On $ZCASH_NETWORK this script never falls back to service/.env." >&2
      exit 1
    fi
  done
fi

# Secrets: the passphrase lives in the config (ignored by git). Only a testnet config may fall
# back to the one in service/.env; any other network must bring its own, so a mainnet seed is
# never encrypted with the testnet passphrase without the operator choosing it.
if ! grep -Eq '^PAYSLIP_SEED_PASSPHRASE=.+' "$CONFIG"; then
  if [ "$ZCASH_NETWORK" != "testnet" ]; then
    echo "Set PAYSLIP_SEED_PASSPHRASE in $CONFIG. On $ZCASH_NETWORK this script never uses the passphrase from service/.env or the shell." >&2
    exit 1
  fi
  if [ -f "$ROOT/service/.env" ]; then
    PAYSLIP_SEED_PASSPHRASE="$(grep '^PAYSLIP_SEED_PASSPHRASE=' "$ROOT/service/.env" | head -1 | cut -d= -f2-)"
    export PAYSLIP_SEED_PASSPHRASE
  fi
fi
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
  # Reuse it only if it holds this config's wallet: another wallet on the same port (a demo
  # service, say) must never get these contractors or pay this run from its treasury.
  expected_treasury=$("$BIN" address 2>/dev/null) || {
    echo "Could not read the treasury address of the seed in $DATA; check PAYSLIP_SEED_PASSPHRASE." >&2
    exit 1
  }
  running_treasury=$(curl -fsS "$API/api/wallet" 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["treasury"]["unified_address"])' 2>/dev/null || true)
  if [ -z "$running_treasury" ] || [ "$running_treasury" != "$expected_treasury" ]; then
    echo "The Payslip service on $API holds a different wallet than $DATA:" >&2
    echo "  running service treasury: ${running_treasury:-unknown (no wallet answer)}" >&2
    echo "  this config's treasury:   $expected_treasury" >&2
    echo "Stop that service, or set PAYSLIP_BIND in $CONFIG to a free port. Nothing was changed." >&2
    exit 1
  fi
  stamp "Reusing the $running_net service on $API (same treasury as $DATA)"
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
# A new DEMO_RUN_SALT is a deliberate second run for the same period, so it may overlap the first.
st, run = call("POST", "/api/runs", {"period_start": spec["period_start"], "period_end": spec["period_end"], "lines": lines, "idempotency_key": key,
                                     "allow_overlap": bool(os.environ.get("DEMO_RUN_SALT"))})
rid = run["id"]
stamp(f"Run {rid} ({'created' if st == 201 else 'existing'}), status {run['status']}, payroll ${run['total_usd_cents']/100:,.2f}")

# 3. Fund: USDC through the venue (default), or ZEC sent to the treasury (DEMO_FUNDING=zec).
method = (os.environ.get("DEMO_FUNDING") or "usdc").strip().lower()
if method not in ("usdc", "zec"):
    sys.exit("DEMO_FUNDING must be usdc (the default) or zec.")
if run["status"] == "draft":
    if NET == "mainnet" and os.environ.get("YES") != "--yes":
        if not sys.stdin.isatty():
            sys.exit("Mainnet funding spends real money. Re-run with --yes to confirm.")
        ask = "request the treasury address and ZEC amount" if method == "zec" else "request a USDC deposit address"
        if input(f"Mainnet: {ask} for this run? Type yes: ").strip() != "yes":
            sys.exit("Stopped before funding.")
    if method == "zec":
        run = call("POST", f"/api/runs/{rid}/fund", {"method": "zec"})[1]
    else:
        run = call("POST", f"/api/runs/{rid}/fund", {"origin_chain": os.environ.get("DEMO_ORIGIN_CHAIN") or "base",
                                                     "refund_address": os.environ.get("DEMO_REFUND_ADDRESS") or None})[1]
f = run.get("funding") or {}
if run["status"] == "awaiting_funds" and f.get("venue") == "treasury":
    stamp(f"Fund with ZEC: send {f.get('amount_in')} ZEC to the treasury address {f.get('treasury_address')} "
          f"before {f.get('deadline')} (1 ZEC = {(f.get('rate_usd_per_zec_e6') or 0) / 1e6:,.2f} USD when requested)")
    stamp("Send it shielded from any Zcash wallet. The run is funded at the market rate of the block in which it confirms.")
    last = None
    while run["status"] == "awaiting_funds":
        time.sleep(10)
        run = call("GET", f"/api/runs/{rid}/funding")[1]
        f = run.get("funding") or {}
        seen = (f.get("status"), f.get("zec_received_zat"), f.get("zec_pending_zat"), f.get("zec_shortfall_zat"))
        if seen != last:
            stamp(f"Treasury: {f.get('status')}, confirmed {(f.get('zec_received_zat') or 0) / 1e8:.8f} ZEC, "
                  f"confirming {(f.get('zec_pending_zat') or 0) / 1e8:.8f} ZEC, "
                  f"still needed {(f.get('zec_shortfall_zat') or 0) / 1e8:.8f} ZEC")
            last = seen
        if f.get("status") == "expired":
            sys.exit("The ZEC request expired before enough ZEC confirmed. Re-run this script to request again; "
                     "ZEC already in the treasury counts toward the new request.")
elif run["status"] == "awaiting_funds":
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

export_ = call("GET", "/api/viewing-keys")[1]
keys = export_["keys"]
first = next(k for k in keys if k["contractor_id"] == ids[0])
today = time.strftime("%Y-%m-%d", time.gmtime())
period = {"from": "2026-01-01", "to": today}
_, csv1 = call("POST", "/api/statements/contractor.csv", {"ufvk": first["ufvk"], **period}, raw=True)
open(os.path.join(OUT, f"statement-{NET}-{people[0]['name'].replace(' ', '-')}.csv"), "wb").write(csv1)
_, rec = call("POST", "/api/statements/accountant", {"ufvks": [k["ufvk"] for k in keys], **period})
_, csv2 = call("POST", "/api/statements/accountant.csv", {"ufvks": [k["ufvk"] for k in keys], **period}, raw=True)
open(os.path.join(OUT, f"reconciliation-{NET}.csv"), "wb").write(csv2)
mine = next((r for r in rec["runs"] if r["run_id"] == rid), None)

# 6. Judge kit: the viewing keys (no spending power) and one payment proof, so anyone can check
# the run from the chain with a statements-only Payslip deployment. The keys cover every account
# of this seed, so the kit makes the whole wallet readable: publish it only for a throwaway demo
# seed, never for one that pays real contractors.
paid = sorted((r for r in call("GET", "/api/runs")[1]["runs"] if r.get("status") == "paid"),
              key=lambda r: (r.get("period_start") or "", r["id"]))
kit = {"network": NET, "run_id": rid, "run_ids": [r["id"] for r in paid] or [rid],
       "note": f"{NET.capitalize()} viewing keys for Payslip's throwaway demo wallet, published on purpose. "
               "They reveal only this wallet's payroll runs (run_ids) and cannot spend.",
       "birthday_height": export_.get("birthday_height"), "keys": keys}
first_line = next((l for l in run["lines"] if l["contractor_id"] == ids[0]), None)
if first_line and first_line.get("txid"):
    try:
        code, pr = call("POST", "/api/proofs", {"ufvk": first["ufvk"], "txid": first_line["txid"]})
    except SystemExit as e:  # the run is paid; a missing proof must not hide that
        stamp(f"Payment proof not created: {e}")
        code, pr = 0, {}
    if code == 200 and pr.get("proofs"):
        kit["payment_proof"] = {"contractor": first_line["contractor_name"], "txid": first_line["txid"],
                                "height": first_line.get("confirmed_height"), "token": pr["proofs"][0]["token"]}
        md += ["", f"Payment proof for {first_line['contractor_name']} (discloses that one payment only): "
               f"open `/verify#{pr['proofs'][0]['token']}` on any Payslip web app serving {NET}."]
kit_path = os.path.join(OUT, f"judge-kit-{NET}.json")
open(kit_path, "w").write(json.dumps(kit, indent=2) + "\n")
md += ["", f"Judge kit (viewing keys and payment proof): `{os.path.basename(kit_path)}`. "
       "Copy it to docs/judge/ to publish; viewing keys reveal these demo accounts' payments and cannot spend."]
open(proof, "w").write("\n".join(md) + "\n")
stamp(f"Judge kit written to {kit_path}")
stamp(f"Accountant reconciliation for this run: {mine['status'] if mine else 'not found'}"
      + (f", variance ${mine['variance_usd_cents']/100:,.2f}, explained ${mine['explained_usd_cents']/100:,.2f}" if mine and mine.get('variance_usd_cents') is not None else ""))
print("\n".join(md))
if generated:
    print("\nThe contractors are generated demo wallets. After recording, return their ZEC to the treasury with:")
    print(f"  cd service && ./target/release/payslip-service dev-sweep{' --allow-mainnet' if NET == 'mainnet' else ''}")
PY
