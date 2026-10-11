/*
  Fund with ZEC (ADR-025) on the Fund step, short of sending coins: the service is replaced by a
  fixture for this test, as wallet-fund.spec.ts does for the USDC path, because a real treasury
  deposit moves money and a testnet service with the fixed-rate venue shows the single testnet
  flow instead of the two cards. The fixture mirrors the shapes docs/API.md documents for
  `method: "zec"`: the treasury address, the ZEC asked for, the rate, the deadline, then a poll
  that reports part of the ZEC confirmed and the shortfall. Nothing here is shown as demo data.

  Needs only the web app running: E2E_BASE_URL (default http://127.0.0.1:3100).
  Run: pnpm exec playwright test e2e/zec-fund.spec.ts
*/
import { expect, test, type Page } from "@playwright/test";

const API = (process.env.E2E_API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const RUN_ID = "4b3d9c1e-2f6a-4e8b-9c0d-7a1e5f3b2c44";
const TREASURY =
  "u1l8xunezsvhq8fgzfl7404m450nwnd76zshscn6nfys7vyz2ywyh4cc5daaq0c7q2su5lqfh23sp7fkf3kt27ve5948mzpjkmh6rfxq6lzq";
const REQUIRED_ZAT = 2_250_000; // 0.02250000 ZEC for a $30.38 payroll at $1,234.42 with reserve and buffer
const RATE_E6 = 1_234_420_000;
const RECEIVED_ZAT = 1_000_000;
const SHORTFALL_ZAT = 1_205_882;

const people: [string, number, string][] = [
  ["Amara Okafor", 480, "INV-2026-014"],
  ["Mateo Fernandez", 625, "MF-0923"],
  ["Priya Raman", 540, "PR-INV-31"],
  ["Jonas Lindqvist", 710, "JL-2026-09"],
  ["Mei Chen", 395, "INV-0047"],
  ["Kwame Mensah", 288, "KM-SEP-26"],
];

type Phase = "draft" | "requested" | "partial" | "funded";
type Net = "mainnet" | "testnet";

/** What a treasury that already covered the run answers: funded at once, at the market rate. */
function fundedFunding() {
  const now = new Date().toISOString();
  return {
    venue: "treasury",
    status: "success",
    origin_asset: "ZEC",
    origin_chain: null,
    token_address: null,
    chain_id: null,
    amount_in: "0.02250000",
    amount_in_base_units: String(REQUIRED_ZAT),
    deposit_address: TREASURY,
    treasury_address: TREASURY,
    deadline: new Date(Date.now() + 24 * 3_600_000).toISOString(),
    requested_usd_cents: 3038,
    quoted_zat: REQUIRED_ZAT,
    quote_rate_e6: RATE_E6,
    zec_required_zat: REQUIRED_ZAT,
    zec_received_zat: REQUIRED_ZAT,
    zec_pending_zat: 0,
    zec_shortfall_zat: 0,
    funded_at_height: 4_489_154,
    priced_at: now,
    funded_usd_cents: 2777,
    zec_acquired_zat: REQUIRED_ZAT,
    rate_usd_per_zec_e6: RATE_E6,
    delivered_txids: [],
    deposit_tx_hash: null,
    venue_ref: null,
    venue_status: "FUNDED",
    refund_reason: null,
  };
}

function fixtureRun(phase: Phase, net: Net = "mainnet") {
  const now = new Date().toISOString();
  const funding =
    phase === "draft"
      ? null
      : phase === "funded"
        ? fundedFunding()
        : {
            venue: "treasury",
            status: phase === "partial" ? "deposit_seen" : "awaiting_deposit",
            origin_asset: "ZEC",
            origin_chain: null,
            token_address: null,
            chain_id: null,
            amount_in: "0.02250000",
            amount_in_base_units: String(REQUIRED_ZAT),
            deposit_address: TREASURY,
            treasury_address: TREASURY,
            deadline: new Date(Date.now() + 24 * 3_600_000).toISOString(),
            requested_usd_cents: 3038,
            quoted_zat: REQUIRED_ZAT,
            quote_rate_e6: RATE_E6,
            zec_required_zat: REQUIRED_ZAT,
            zec_received_zat: phase === "partial" ? RECEIVED_ZAT : 0,
            zec_pending_zat: 0,
            zec_shortfall_zat: phase === "partial" ? SHORTFALL_ZAT : REQUIRED_ZAT - 44_118,
            funded_at_height: null,
            priced_at: now,
            funded_usd_cents: null,
            zec_acquired_zat: null,
            rate_usd_per_zec_e6: RATE_E6,
            delivered_txids: [],
            deposit_tx_hash: null,
            venue_ref: null,
            venue_status: phase === "partial" ? "PARTIAL" : "AWAITING_ZEC",
            refund_reason: null,
          };
  return {
    id: RUN_ID,
    status: phase === "draft" ? "draft" : phase === "funded" ? "funded" : "awaiting_funds",
    failed_from: null,
    period_start: "2026-09-01",
    period_end: "2026-09-30",
    period_label: "2026-09",
    total_usd_cents: 3038,
    total_zat: null,
    funding,
    allocation_txid: null,
    allocation_height: null,
    allocation_explorer_url: null,
    fees_zat: 0,
    lines: people.map(([name, cents, inv], i) => ({
      id: `line-${i}`,
      contractor_id: `contractor-${i}`,
      contractor_name: name,
      account_index: i + 1,
      invoice_ref: inv,
      amount_usd_cents: cents,
      amount_zat: null,
      status: "pending",
      txid: null,
      confirmed_height: null,
      explorer_url: null,
      memo: null,
      settlement_choice: "hold_zec",
      payout_chain: null,
      settlement: null,
      error: null,
    })),
    error: null,
    created_at: now,
    updated_at: now,
    executing: false,
    network: net,
  };
}

/**
 * Installs the service fixture. Records the fund request and advances the phase on each poll. On
 * testnet the service runs the fixed-rate venue and also offers Fund with ZEC; its treasury holds
 * faucet coins that already cover the run, so the ZEC request comes back funded.
 */
async function prepare(page: Page, net: Net = "mainnet") {
  const testnet = net === "testnet";
  const state: { phase: Phase; fundBody: Record<string, unknown> | null; polls: number } = {
    phase: "draft",
    fundBody: null,
    polls: 0,
  };
  // No traffic leaves the machine.
  await page.route(
    (url) => !["127.0.0.1", "localhost"].includes(url.hostname),
    (route) => route.abort(),
  );
  await page.route(`${API}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/health")
      return json({
        status: "ok",
        network: net,
        chain_tip: 3_520_100,
        wallet_synced_height: 3_520_100,
        birthday_height: 3_506_600,
        venue: testnet ? "testnet-fixed-rate" : "near-intents-1click",
        warnings: [],
        clock_skew_seconds: 60,
        lightwalletd: testnet ? "https://testnet.zec.rocks:443" : "https://zec.rocks:443",
        lightwalletd_error: null,
        version: "0.1.0",
        mode: "full",
        app_fee_bps: 0,
        market_prices: true,
        simulated_rate_usd_per_zec: testnet ? 1_350_000 : null,
        fund_with_zec: true,
        max_run_usd_cents: null,
      });
    if (url.pathname === `/api/runs/${RUN_ID}/fund` && route.request().method() === "POST") {
      state.fundBody = route.request().postDataJSON();
      state.phase = testnet ? "funded" : "requested";
      return json(fixtureRun(state.phase, net));
    }
    if (url.pathname === `/api/runs/${RUN_ID}/funding`) {
      state.polls += 1;
      if (state.phase === "requested") state.phase = "partial";
      return json(fixtureRun(state.phase, net));
    }
    if (url.pathname === `/api/runs/${RUN_ID}/events`)
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: `event: snapshot\ndata: ${JSON.stringify(fixtureRun(state.phase, net))}\n\n`,
      });
    if (url.pathname === `/api/runs/${RUN_ID}/log`) return json({ events: [] });
    if (url.pathname.startsWith(`/api/runs/${RUN_ID}`)) return json(fixtureRun(state.phase, net));
    if (url.pathname === "/api/runs") return json({ runs: [fixtureRun(state.phase, net)] });
    if (url.pathname === "/api/contractors") return json({ contractors: [] });
    if (url.pathname === "/api/wallet") {
      const held = testnet ? 12_500_000 : 0;
      return json({
        network: net,
        chain_tip: 3_520_100,
        synced_height: 3_520_100,
        birthday_height: 3_506_600,
        contractor_accounts: 6,
        treasury: { account_index: 0, unified_address: TREASURY, spendable_zat: held, pending_zat: 0, total_zat: held },
      });
    }
    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "not_found", message: "not in fixture", hint: "" } }),
    });
  });
  return state;
}

test("Fund step offers ZEC and USDC, and the ZEC card shows the address, amount, rate and shortfall", async ({
  page,
}) => {
  const state = await prepare(page);
  await page.goto(`/console/runs/new?run=${RUN_ID}`);

  // Two cards on the draft: the ZEC request and the USDC quote.
  await expect(page.getByRole("heading", { name: "Fund with ZEC" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Fund with USDC" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Get a USDC quote" })).toBeVisible();
  await page.getByRole("button", { name: "Fund with ZEC" }).click();

  // The request carried the method and nothing of the USDC quote.
  await expect.poll(() => state.fundBody, { timeout: 15_000 }).toEqual({ method: "zec" });

  // The ZEC card: treasury address with QR and copy, the amount with copy, the rate line.
  await expect(page.getByRole("button", { name: "Copy treasury address" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(`${TREASURY.slice(0, 12)}…${TREASURY.slice(-8)}`)).toBeVisible();
  await expect(page.getByRole("img", { name: "QR code of the treasury address" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy amount" })).toBeVisible();
  await expect(page.getByText("0.02250000", { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/1 ZEC ≈/)).toBeVisible();
  await expect(page.getByText(/1,234\.42/).first()).toBeVisible();
  await expect(page.getByText(/Send before/)).toBeVisible();
  await expect(page.getByText(/Waiting for your ZEC/)).toBeVisible();

  // The poll reports part of the ZEC confirmed: the line says what is still needed.
  await expect(page.getByText(/still needed at the current rate/)).toBeVisible({ timeout: 20_000 });
  expect(state.polls).toBeGreaterThan(0);

  // USDC stays one step away.
  await page.getByRole("button", { name: "Fund with USDC instead" }).click();
  await expect(page.getByRole("heading", { name: "Fund with USDC" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Get a USDC quote" })).toBeVisible();
});

test("On testnet the Fund step offers Fund with ZEC beside the treasury, and a covered treasury funds at once", async ({
  page,
}) => {
  const state = await prepare(page, "testnet");
  await page.goto(`/console/runs/new?run=${RUN_ID}`);

  // The testnet action stays first; Fund with ZEC sits under it, and no USDC is offered.
  await expect(page.getByRole("button", { name: "Fund from treasury" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Fund with ZEC" })).toBeVisible();
  await expect(page.getByText(/faucet coins already in the treasury count/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fund with USDC" })).toHaveCount(0);
  await page.getByRole("button", { name: "Fund with ZEC" }).click();
  await expect.poll(() => state.fundBody, { timeout: 15_000 }).toEqual({ method: "zec" });

  // The treasury covered the run: straight to Pay, at the market rate, not the simulated one.
  await expect(page.getByRole("button", { name: "Pay 6 contractors" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Simulated rate")).toHaveCount(0);
  // The confirm dialog restates the rate; Cancel closes it without paying.
  await page.getByRole("button", { name: "Pay 6 contractors" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("At the locked rate")).toBeVisible();
  await expect(dialog.getByText("At the simulated rate")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
});
