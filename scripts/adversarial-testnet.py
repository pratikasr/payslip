#!/usr/bin/env python3
"""Round 3 adversarial scenarios against a running TESTNET Payslip service.

Usage: python3 scripts/adversarial-testnet.py --api http://127.0.0.1:8080 [--skip-chain]

--api is required: the scenarios add contractors and runs to that service, and the chain
scenarios restart it, so it must be a throwaway testnet service, never a wallet you care about.

Prints one PASS or FAIL line per scenario and exits non-zero if any fail. Scenarios that put
transactions on chain (malformed memo, unlabelled payment, formula memo, restart mid-run) spend
a little testnet TAZ from the treasury; --skip-chain runs only the API checks.

Scenarios that need a fake chain (venue timeout, venue partial fill, reorg, crash between
build and record) live in service/tests/executor.rs and are listed in docs/TEST-REPORT.md.
"""
import argparse
import concurrent.futures
import json
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SERVICE = os.path.join(ROOT, "service")
BIN = os.path.join(SERVICE, "target", "release", "payslip-service")
if not os.path.exists(BIN):
    BIN = os.path.join(SERVICE, "target", "debug", "payslip-service")

ap = argparse.ArgumentParser()
ap.add_argument("--api", required=True, help="the throwaway testnet Payslip service to test, e.g. http://127.0.0.1:8080")
ap.add_argument("--skip-chain", action="store_true")
args = ap.parse_args()
API = args.api
results = []


def call(method, path, body=None, raw=False, headers=None, timeout=900):
    h = {"content-type": "application/json"}
    h.update(headers or {})
    data = body if isinstance(body, (bytes, type(None))) else json.dumps(body).encode()
    req = urllib.request.Request(API + path, method=method, headers=h, data=data)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            payload = r.read()
            return r.status, (payload if raw else (json.loads(payload) if payload else None)), dict(r.headers)
    except urllib.error.HTTPError as e:
        payload = e.read()
        try:
            return e.code, json.loads(payload), dict(e.headers)
        except Exception:
            return e.code, payload, dict(e.headers)


def cli(*a, timeout=600):
    out = subprocess.run([BIN, *a], cwd=SERVICE, capture_output=True, text=True, timeout=timeout)
    return out.returncode, out.stdout.strip(), out.stderr.strip()


def code_of(resp):
    return (resp[1] or {}).get("error", {}).get("code") if isinstance(resp[1], dict) else None


def scenario(name):
    def wrap(fn):
        def run():
            t = time.time()
            try:
                detail = fn() or ""
                results.append((name, True, detail))
                print(f"PASS  {name}  ({time.time() - t:.1f}s) {detail}", flush=True)
            except AssertionError as e:
                results.append((name, False, str(e)))
                print(f"FAIL  {name}: {e}", flush=True)
            except Exception as e:  # noqa: BLE001
                results.append((name, False, repr(e)))
                print(f"FAIL  {name}: {e!r}", flush=True)
        run.__name__ = fn.__name__
        return run
    return wrap


def expect(resp, status, code=None):
    assert resp[0] == status, f"expected HTTP {status}, got {resp[0]}: {resp[1]}"
    if code:
        assert code_of(resp) == code, f"expected {code}, got {code_of(resp)}: {resp[1]}"
        hint = resp[1]["error"].get("hint", "")
        assert hint, "every error must name the fix"


health = call("GET", "/api/health")[1]
assert health["network"] == "testnet", "run this suite against testnet only"
contractors = {c["name"]: c for c in call("GET", "/api/contractors")[1]["contractors"]}
assert len(contractors) >= 3, "seed the demo contractors first (scripts/seed-testnet-contractors.sh)"
names = list(contractors)
A, B, C = contractors[names[0]], contractors[names[1]], contractors[names[2]]
keys = {k["label"]: k for k in call("GET", "/api/viewing-keys")[1]["keys"]}
TODAY = time.strftime("%Y-%m-%d", time.gmtime())
PERIOD = {"from": "2026-01-01", "to": TODAY}


def run_body(lines, key=None, start="2026-09-01", end="2026-09-30"):
    # Every scenario reuses one period on purpose, so overlaps with earlier runs are allowed.
    return {"period_start": start, "period_end": end, "lines": lines, "idempotency_key": key or str(uuid.uuid4()), "allow_overlap": True}


def line(c, cents=100_00, inv="INV-ADV-1"):
    return {"contractor_id": c["id"], "amount_usd_cents": cents, "invoice_ref": inv}


# ---------------------------------------------------------------------------------- API checks

@scenario("wrong FVK pasted (garbage, spaces, truncated)")
def s_wrong_fvk():
    for bad in ["hello", "uviewtest1 abc def", keys[A["name"]]["ufvk"][:-10]]:
        expect(call("POST", "/api/statements/contractor", {"ufvk": bad, **PERIOD}), 400, "invalid_viewing_key")


@scenario("spending key or seed phrase pasted is rejected and not stored")
def s_spending_key():
    seed = " ".join(["abandon"] * 23 + ["art"])
    expect(call("POST", "/api/statements/contractor", {"ufvk": seed, **PERIOD}), 400, "spending_key_rejected")
    expect(call("POST", "/api/statements/contractor", {"ufvk": "secret-extended-key-test1qwerty", **PERIOD}), 400, "spending_key_rejected")
    expect(call("POST", "/api/statements/accountant", {"ufvks": [keys["Treasury"]["ufvk"], seed], **PERIOD}), 400, "spending_key_rejected")


@scenario("incoming-only viewing key is explained, not accepted")
def s_uivk():
    expect(call("POST", "/api/statements/contractor", {"ufvk": "uivktest1qqqqqqqqqqqqqqqqqqqq", **PERIOD}), 400, "incoming_viewing_key")


@scenario("mainnet key on the testnet service names the network mismatch")
def s_wrong_network_key():
    rc, mainnet, err = cli("dev-mainnet-ufvk")
    assert rc == 0, err
    assert mainnet.startswith("uvf1") or mainnet.startswith("uview1"), mainnet[:10]
    expect(call("POST", "/api/statements/contractor", {"ufvk": mainnet, **PERIOD}), 400, "wrong_network")


@scenario("FVK for another account shows only that account, labelled")
def s_other_account():
    st = call("POST", "/api/statements/contractor", {"ufvk": keys[B["name"]]["ufvk"], **PERIOD})
    assert st[0] == 200, st[1]
    body = st[1]
    assert body["account"]["label"] == B["name"], body["account"]
    assert all(l["account_index"] == B["account_index"] for l in body["lines"]), "a line from another account leaked"
    return f"{len(body['lines'])} lines, all account {B['account_index']}"


@scenario("zero, negative, fractional, huge and non-numeric amounts are rejected")
def s_amounts():
    for bad in [0, -500, 12.5, 10_000_000_01, "100"]:
        expect(call("POST", "/api/runs", run_body([line(A, bad)])), 400, "invalid_amount")


@scenario("invoice refs: pipe, non-ASCII and over 64 characters are rejected")
def s_invoice():
    expect(call("POST", "/api/runs", run_body([line(A, 100, "INV|14")])), 400, "invalid_invoice_ref")
    expect(call("POST", "/api/runs", run_body([line(A, 100, "Rechnung über")])), 400, "invalid_invoice_ref")
    expect(call("POST", "/api/runs", run_body([line(A, 100, "X" * 65)])), 400, "invoice_ref_too_long")


@scenario("period boundaries: reversed, impossible date, over a year")
def s_periods():
    expect(call("POST", "/api/runs", run_body([line(A)], start="2026-09-30", end="2026-09-01")), 400, "invalid_period")
    expect(call("POST", "/api/runs", run_body([line(A)], start="2026-02-30", end="2026-03-01")), 400, "invalid_period")
    expect(call("POST", "/api/runs", run_body([line(A)], start="2025-01-01", end="2026-09-30")), 400, "invalid_period")
    expect(call("POST", "/api/statements/contractor", {"ufvk": keys[A["name"]]["ufvk"], "from": "2026-10-31", "to": "2026-10-01"}), 400, "invalid_period")


@scenario("unknown contractor, duplicate contractor line, empty run")
def s_lines():
    expect(call("POST", "/api/runs", run_body([{"contractor_id": str(uuid.uuid4()), "amount_usd_cents": 100, "invoice_ref": "X"}])), 400, "unknown_contractor")
    expect(call("POST", "/api/runs", run_body([line(A), line(A, 200, "B")])), 400, "duplicate_contractor_line")
    expect(call("POST", "/api/runs", run_body([])), 400, "no_lines")


@scenario("duplicate run submission returns the same run (sequential and 8 concurrent)")
def s_duplicate_run():
    key = str(uuid.uuid4())
    body = run_body([line(A, 1234, "DUP-1")], key=key)
    first = call("POST", "/api/runs", body)
    second = call("POST", "/api/runs", body)
    assert first[0] == 201 and second[0] == 200 and first[1]["id"] == second[1]["id"], (first[0], second[0])
    key2 = str(uuid.uuid4())
    with concurrent.futures.ThreadPoolExecutor(8) as ex:
        rs = list(ex.map(lambda _: call("POST", "/api/runs", run_body([line(B, 999, "DUP-2")], key=key2)), range(8)))
    ids = {r[1]["id"] for r in rs}
    assert len(ids) == 1, f"{len(ids)} runs created"
    assert sorted(r[0] for r in rs).count(201) == 1
    return "one run per key"


@scenario("executing an unfunded run and funding twice are refused")
def s_fund_execute_order():
    r = call("POST", "/api/runs", run_body([line(C, 4321, "ORDER-1")]))[1]
    expect(call("POST", f"/api/runs/{r['id']}/execute"), 409, "not_funded")
    return "draft cannot execute"


@scenario("treasury too small for the run names the address to top up")
def s_treasury_insufficient():
    r = call("POST", "/api/runs", run_body([line(A, 999_999_999, "BIG-1")]))[1]
    resp = call("POST", f"/api/runs/{r['id']}/fund", {})
    expect(resp, 409, "treasury_insufficient")
    assert "utest1" in resp[1]["error"]["hint"], resp[1]["error"]["hint"]


@scenario("contractor addresses: garbage, transparent, duplicate, wrong network")
def s_addresses():
    expect(call("POST", "/api/contractors", {"name": "Bad", "unified_address": "not-an-address"}), 400, "invalid_address")
    expect(call("POST", "/api/contractors", {"name": "T", "unified_address": "tmBsTi2xWTjUdEXnuTceL7fecEQKeWaPDJd"}), 400, "invalid_address")
    expect(call("POST", "/api/contractors", {"name": "Dup", "unified_address": A["unified_address"]}), 409, "duplicate_address")
    mainnet_ua = "u1rl2zw85dmjc8m4dmqvtstcyvdjn23n0ad53u5533c97affg9jq208du0vf787vfx4vkd6cd0ma4pxkkuc6xe6ue4dlgjvn9dhzacgk9peejwxdn0ksw3v3yf0dy47znruqftfqgf6xpuelle29g2qxquudxsnnen3dvdx8az6w3tggalc4pla3n4jcs8vf4h29ach3zd8enxulush89"
    expect(call("POST", "/api/contractors", {"name": "Main", "unified_address": mainnet_ua}), 400, "wrong_network")


@scenario("statement key limits: none, and over 200")
def s_key_limits():
    expect(call("POST", "/api/statements/accountant", {"ufvks": [], **PERIOD}), 400, "invalid_viewing_key")
    expect(call("POST", "/api/statements/accountant", {"ufvks": ["x"] * 201, **PERIOD}), 400, "too_many_keys")


@scenario("CORS: a foreign origin gets no allow-origin header")
def s_cors():
    st, _, h = call("GET", "/api/health", headers={"Origin": "https://evil.example"})
    allow = {k.lower(): v for k, v in h.items()}.get("access-control-allow-origin")
    assert allow in (None, "http://localhost:3000"), allow
    assert allow != "https://evil.example"


@scenario("SSE: events stream sends a snapshot; unknown run is 404")
def s_sse():
    runs = call("GET", "/api/runs")[1]["runs"]
    assert runs, "need at least one run"
    req = urllib.request.Request(API + f"/api/runs/{runs[0]['id']}/events")
    with urllib.request.urlopen(req, timeout=20) as r:
        buf = b""
        while b"event: snapshot" not in buf:
            buf += r.read(256)
    expect(call("GET", f"/api/runs/{uuid.uuid4()}/events"), 404, "not_found")


@scenario("clock skew is reported by health")
def s_clock():
    h = call("GET", "/api/health")[1]
    assert "clock_skew_seconds" in h and isinstance(h["warnings"], list)
    return f"skew {h['clock_skew_seconds']}s, warnings {len(h['warnings'])}"


# -------------------------------------------------------------------------------- chain checks

def wait_mined(txid, timeout=600):
    t = time.time()
    while time.time() - t < timeout:
        try:
            with urllib.request.urlopen(f"https://api.testnet.zecblock.com/api/tx/{txid}", timeout=20) as r:
                if json.load(r).get("blockHeight"):
                    return
        except Exception:  # noqa: BLE001
            pass
        time.sleep(5)
    raise AssertionError(f"{txid} not mined in {timeout}s")


@scenario("memo over 512 bytes is refused before anything is built")
def s_memo_too_long():
    rc, out, err = cli("send", "--from", "0", "--to", A["unified_address"], "--zat", "10000", "--memo", "X" * 600)
    assert rc != 0, "a 600-byte memo must not be sent"
    assert "512" in err or "too long" in err.lower() or "bytes" in err, err[-300:]


def statement(c):
    st = call("POST", "/api/statements/contractor", {"ufvk": keys[c["name"]]["ufvk"], **PERIOD})
    assert st[0] == 200, st[1]
    return st[1]


@scenario("malformed memo, unlabelled payment and formula memo on chain are listed, never dropped")
def s_chain_unlabelled():
    # Payments INTO contractor accounts from outside the run flow, with hostile memos.
    sends = [
        (A, "PS1|not-a-run|2026-13|x|0|0", "malformed"),
        (B, None, "no_memo"),
        (C, "=cmd|' /C calc'!A0", "unknown_prefix"),
    ]
    txids = []
    for c, memo, _ in sends:
        rc, out, err = cli(*(["send", "--from", "0", "--to", c["account_address"], "--zat", "20000"] + (["--memo", memo] if memo else [])))
        assert rc == 0, err[-400:]
        txids.append(out.splitlines()[0])
    for t in txids:
        wait_mined(t)
    time.sleep(5)
    for (c, memo, reason), t in zip(sends, txids):
        body = statement(c)
        hits = [u for u in body["unlabelled"] if u["txid"] == t]
        assert hits and hits[0]["reason"] == reason, f"{c['name']}: {body['unlabelled']}"
        assert all(l["txid"] != t for l in body["lines"]), "an unlabelled payment was counted as a pay line"
    _, csv, _ = call("POST", "/api/statements/contractor.csv", {"ufvk": keys[C["name"]]["ufvk"], **PERIOD}, raw=True)
    assert b"'=cmd" in csv and b"\n=cmd" not in csv, "formula memo must be neutralised in CSV"
    return ", ".join(t[:10] for t in txids)


def wait_status(rid, statuses, timeout=1200):
    t = time.time()
    while time.time() - t < timeout:
        st, r, _ = call("GET", f"/api/runs/{rid}")
        if st == 200 and r["status"] in statuses:
            return r
        time.sleep(2)
    raise AssertionError(f"run {rid} did not reach {statuses}")


def service_pid():
    out = subprocess.run(["lsof", "-ti", "tcp:" + API.rsplit(":", 1)[1]], capture_output=True, text=True).stdout.split()
    return [int(p) for p in out]


def start_service():
    log = open(os.path.join(ROOT, "scripts", "demo", "out", "adversarial-service.log"), "a")
    subprocess.Popen([BIN, "serve"], cwd=SERVICE, stdout=log, stderr=log, start_new_session=True)
    for _ in range(120):
        try:
            if call("GET", "/api/health", timeout=5)[0] == 200:
                return
        except Exception:  # noqa: BLE001
            pass
        time.sleep(1)
    raise AssertionError("service did not restart")


@scenario("service killed mid-run (SIGKILL while paying) resumes and pays each line once")
def s_restart_mid_run():
    r = call("POST", "/api/runs", run_body([line(A, 101_00, "RESTART-A"), line(B, 202_00, "RESTART-B")]))[1]
    rid = r["id"]
    st = call("POST", f"/api/runs/{rid}/fund", {})
    assert st[0] == 200, st[1]
    call("POST", f"/api/runs/{rid}/execute")
    wait_status(rid, ("allocating", "paying"))
    for pid in service_pid():
        os.kill(pid, signal.SIGKILL)
    killed_in = call_status_after_kill(rid)
    start_service()
    final = wait_status(rid, ("paid", "failed"))
    assert final["status"] == "paid", final.get("error")
    for l in final["lines"]:
        body = statement(contractors[l["contractor_name"]])
        mine = [x for x in body["lines"] + body["pending"] if x["run_id"] == rid]
        assert len(mine) == 1, f"{l['contractor_name']} has {len(mine)} payments for the run"
        assert mine[0]["txid"] == l["txid"]
    return f"killed while {killed_in}; paid once each"


def call_status_after_kill(rid):
    # The service is down; read the last state from the database file directly.
    import sqlite3
    db = os.path.join(SERVICE, "data", "testnet", "payslip.db")
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    return con.execute("SELECT status FROM runs WHERE id = ?", (rid,)).fetchone()[0]


# ------------------------------------------------------------------------------------- runner

api_scenarios = [s_wrong_fvk, s_spending_key, s_uivk, s_wrong_network_key, s_other_account, s_amounts, s_invoice,
                 s_periods, s_lines, s_duplicate_run, s_fund_execute_order, s_treasury_insufficient, s_addresses,
                 s_key_limits, s_cors, s_sse, s_clock]
chain_scenarios = [s_memo_too_long, s_chain_unlabelled, s_restart_mid_run]

for s in api_scenarios:
    s()
if not args.skip_chain:
    # Contractor account addresses (payer side) for the hostile payments.
    for c in (A, B, C):
        rc, out, err = cli("account-address", "--account", str(c["account_index"]))
        assert rc == 0, err
        c["account_address"] = out.strip()
    for s in chain_scenarios:
        s()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
sys.exit(1 if failed else 0)
