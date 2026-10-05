/*
  The mainnet Fund step, short of signing: a stand-in EIP-1193 wallet is injected into the page,
  and the test checks the exact transfer the app asks it to send (token contract, recipient,
  amount, chain) and that the transaction hash is reported back to the service.

  The service is replaced by a fixture for this one test, because no testnet USDC venue exists
  and the real flow would move money. The fixture mirrors a real 1Click quote taken on mainnet
  on 5 Oct 2026 (deposit address, amount, token). Nothing here is shown as demo data.

  Needs only the web app running: E2E_BASE_URL (default http://127.0.0.1:3100).
  Run: pnpm exec playwright test e2e/wallet-fund.spec.ts
*/
import { expect, test, type Page } from "@playwright/test";

const API = (process.env.E2E_API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const RUN_ID = "0f7c2a52-5d41-4e3a-9b1e-3c9d2f6a8b10";
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const DEPOSIT = "0x992f2FF0d8A81DDFFe6c5DE00BBD4C483A0b8467";
const AMOUNT_BASE_UNITS = 32_510_000n; // 32.51 USDC, 6 decimals
const PAYER = "0x2527d02599ba641c19fea793cd0f167589a0f10d";
const FAKE_HASH = `0x${"ab".repeat(32)}`;

const people: [string, number, string][] = [
  ["Amara Okafor", 480, "INV-2026-014"],
  ["Mateo Fernandez", 625, "MF-0923"],
  ["Priya Raman", 540, "PR-INV-31"],
  ["Jonas Lindqvist", 710, "JL-2026-09"],
  ["Mei Chen", 395, "INV-0047"],
  ["Kwame Mensah", 288, "KM-SEP-26"],
];

function fixtureRun(depositTx: string | null) {
  const now = new Date().toISOString();
  return {
    id: RUN_ID,
    status: "awaiting_funds",
    failed_from: null,
    period_start: "2026-09-01",
    period_end: "2026-09-30",
    period_label: "2026-09",
    total_usd_cents: 3038,
    total_zat: null,
    funding: {
      venue: "near-intents-1click",
      status: depositTx ? "deposit_seen" : "awaiting_deposit",
      origin_asset: "USDC",
      origin_chain: "base",
      token_address: USDC_BASE,
      chain_id: 8453,
      amount_in: "32.51",
      amount_in_base_units: AMOUNT_BASE_UNITS.toString(),
      deposit_address: DEPOSIT,
      deadline: new Date(Date.now() + 3_600_000).toISOString(),
      requested_usd_cents: 3251,
      quoted_zat: 2_399_000,
      quote_rate_e6: 1_355_148_000,
      funded_usd_cents: null,
      zec_acquired_zat: null,
      rate_usd_per_zec_e6: null,
      delivered_txids: [],
      deposit_tx_hash: depositTx,
      venue_ref: null,
      venue_status: depositTx ? "KNOWN_DEPOSIT_TX" : "PENDING_DEPOSIT",
      refund_reason: null,
    },
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
    network: "mainnet",
  };
}

type Sent = { to: string; from: string; data: string; value?: string };

/** Installs the stand-in wallet and the service fixture. `reject` makes the wallet refuse to sign. */
async function prepare(page: Page, reject: boolean) {
  const state: { reported: { tx_hash?: string } | null } = { reported: null };

  // Stand-in wallet: records what it is asked to sign and never signs anything.
  await page.addInitScript(
    ({ payer, reject }) => {
      const w = window as unknown as Record<string, unknown>;
      const log: { method: string; params?: unknown }[] = [];
      w.__walletLog = log;
      let chainId = "0x1"; // starts on Ethereum so the app must switch to Base
      let connected = false; // a wallet that has not yet authorised this site
      const listeners: Record<string, ((v: unknown) => void)[]> = {};
      w.ethereum = {
        request: async ({ method, params }: { method: string; params?: unknown[] }) => {
          log.push({ method, params });
          switch (method) {
            case "eth_requestAccounts":
              connected = true;
              (listeners.accountsChanged ?? []).forEach((f) => f([payer]));
              return [payer];
            case "eth_accounts":
              return connected ? [payer] : [];
            case "eth_chainId":
              return chainId;
            case "net_version":
              return String(parseInt(chainId, 16));
            case "wallet_requestPermissions":
            case "wallet_getPermissions":
              return [{ parentCapability: "eth_accounts" }];
            case "wallet_switchEthereumChain": {
              chainId = (params?.[0] as { chainId: string }).chainId;
              (listeners.chainChanged ?? []).forEach((f) => f(chainId));
              return null;
            }
            case "eth_sendTransaction":
              w.__sent = params?.[0];
              if (reject) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
              return `0x${"ab".repeat(32)}`;
            default:
              throw Object.assign(new Error(`unsupported ${method}`), { code: 4200 });
          }
        },
        on: (event: string, f: (v: unknown) => void) => {
          (listeners[event] ??= []).push(f);
        },
        removeListener: (event: string, f: (v: unknown) => void) => {
          listeners[event] = (listeners[event] ?? []).filter((x) => x !== f);
        },
      };
    },
    { payer: PAYER, reject },
  );

  // No traffic leaves the machine: public RPCs and anything else external are blocked.
  await page.route(
    (url) => !["127.0.0.1", "localhost"].includes(url.hostname),
    (route) => route.abort(),
  );
  await page.route(`${API}/**`, async (route) => {
    const url = new URL(route.request().url());
    const run = () => fixtureRun(state.reported?.tx_hash ?? null);
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/health")
      return json({
        status: "ok",
        network: "mainnet",
        chain_tip: 3_506_700,
        wallet_synced_height: 3_506_700,
        birthday_height: 3_506_600,
        venue: "near-intents-1click",
        warnings: [],
        clock_skew_seconds: 60,
        lightwalletd: "https://zec.rocks:443",
        lightwalletd_error: null,
        version: "0.1.0",
      });
    if (url.pathname === `/api/runs/${RUN_ID}/funding/deposit-tx`) {
      state.reported = route.request().postDataJSON();
      return json(run());
    }
    if (url.pathname === `/api/runs/${RUN_ID}/events`)
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: `event: snapshot\ndata: ${JSON.stringify(run())}\n\n`,
      });
    if (url.pathname === `/api/runs/${RUN_ID}/log`) return json({ events: [] });
    if (url.pathname.startsWith(`/api/runs/${RUN_ID}`)) return json(run());
    if (url.pathname === "/api/contractors") return json({ contractors: [] });
    if (url.pathname === "/api/wallet")
      return json({
        network: "mainnet",
        chain_tip: 3_506_700,
        synced_height: 3_506_700,
        birthday_height: 3_506_600,
        contractor_accounts: 6,
        treasury: { account_index: 0, unified_address: "u1demo", spendable_zat: 0, pending_zat: 0, total_zat: 0 },
      });
    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "not_found", message: "not in fixture", hint: "" } }),
    });
  });
  return state;
}

/** Opens the run, connects the wallet through RainbowKit and presses send. */
async function connectAndSend(page: Page) {
  await page.goto(`/app/payer/runs/${RUN_ID}`);
  await expect(page.getByRole("button", { name: "Copy deposit address" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`${DEPOSIT.slice(0, 10)}…${DEPOSIT.slice(-8)}`)).toBeVisible();
  await page.getByRole("button", { name: "Connect Wallet" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Browser Wallet|Injected/i })
    .click();
  await page.getByRole("button", { name: "Switch to Base and send" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __sent?: unknown }).__sent), { timeout: 30_000 })
    .toBeTruthy();
}

test("Fund step sends exactly the quoted USDC transfer on Base and reports the hash", async ({ page }) => {
  const state = await prepare(page, false);
  await connectAndSend(page);
  const sent = (await page.evaluate(() => (window as unknown as { __sent: Sent }).__sent)) as Sent;
  const log = (await page.evaluate(() => (window as unknown as { __walletLog: unknown[] }).__walletLog)) as {
    method: string;
    params?: { chainId?: string }[];
  }[];

  // The wallet was moved to Base (chain id 8453 = 0x2105) before anything was sent.
  const switchIdx = log.findIndex((l) => l.method === "wallet_switchEthereumChain");
  const sendIdx = log.findIndex((l) => l.method === "eth_sendTransaction");
  expect(switchIdx).toBeGreaterThanOrEqual(0);
  expect(log[switchIdx].params?.[0]?.chainId).toBe("0x2105");
  expect(sendIdx).toBeGreaterThan(switchIdx);

  // An ERC-20 transfer on the USDC contract: transfer(deposit, 32.51 USDC), from the payer, no ETH value.
  const pad = (hex: string) => hex.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  expect(sent.to.toLowerCase()).toBe(USDC_BASE);
  expect(sent.from.toLowerCase()).toBe(PAYER);
  expect(sent.data.toLowerCase()).toBe(`0xa9059cbb${pad(DEPOSIT)}${pad(AMOUNT_BASE_UNITS.toString(16))}`);
  expect(BigInt(sent.value ?? "0x0")).toBe(0n);

  // The hash goes back to the service, and the page says the deposit was sent.
  await expect.poll(() => state.reported?.tx_hash, { timeout: 15_000 }).toBe(FAKE_HASH);
  await expect(
    page.getByText(/Deposit sent, waiting for Base to confirm|Could not confirm the deposit on Base/),
  ).toBeVisible();
});

test("a rejection in the wallet sends nothing and reports nothing", async ({ page }) => {
  const state = await prepare(page, true);
  await connectAndSend(page);
  await expect(
    page.getByRole("alert").filter({ hasText: "You rejected the request in your wallet. Nothing was sent." }),
  ).toBeVisible({ timeout: 15_000 });
  expect(state.reported).toBeNull();
  await expect(page.getByRole("button", { name: "Send 32.51 USDC" })).toBeVisible();
});
