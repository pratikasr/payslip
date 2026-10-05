/*
  Round 2: the 90-second demo script from docs/SPEC.md, walked through the UI against a real
  testnet service with a clean database. No mocks: every assertion is on data the chain returned.

  Prerequisites (see docs/TEST-REPORT.md, Round 2):
    - the service running on testnet with a clean data directory (scripts/fresh-testnet-env.sh)
    - the web app running (pnpm build && pnpm start)
    - E2E_BASE_URL (default http://127.0.0.1:3100) and E2E_API_URL (default http://127.0.0.1:8080)

  Run: pnpm exec playwright test e2e/demo.spec.ts
*/
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const API = (process.env.E2E_API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const ROOT = join(__dirname, "..", "..");
const EXPLORER_API = "https://api.testnet.zecblock.com/api/tx";

interface DemoContractor {
  name: string;
  email: string;
  amount_usd_cents: number;
  invoice_ref: string;
}

const demo = JSON.parse(readFileSync(join(ROOT, "scripts", "demo", "contractors.example.json"), "utf8")) as {
  contractors: DemoContractor[];
};

function devAddresses(): string[] {
  const bin = process.env.PAYSLIP_BIN ?? join(ROOT, "service", "target", "release", "payslip-service");
  const out = execFileSync(bin, ["dev-contractors", "--count", "6"], {
    cwd: join(ROOT, "service"),
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return out
    .trim()
    .split("\n")
    .map((l) => l.split("\t")[1]);
}

async function api<T>(path: string): Promise<T> {
  const r = await fetch(`${API}${path}`);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

const timings: Record<string, number> = {};
async function timed<T>(page: Page, name: string, body: () => Promise<T>): Promise<T> {
  const t = Date.now();
  const r = await test.step(name, body);
  timings[name] = Math.round((Date.now() - t) / 1000);
  void page;
  return r;
}

test("demo script: onboard six, fund, run, statements, reconciliation, CSV", async ({ page }) => {
  test.setTimeout(45 * 60_000);
  const health = await api<{ network: string; chain_tip: number }>("/api/health");
  expect(health.network, "Round 2 runs on testnet").toBe("testnet");
  const startTip = health.chain_tip;
  const existing = await api<{ contractors: unknown[] }>("/api/contractors");
  expect(existing.contractors, "start from a clean database").toHaveLength(0);
  const addresses = devAddresses();
  expect(addresses).toHaveLength(6);

  await timed(page, "onboard six contractors", async () => {
    await page.goto("/app/payer/contractors");
    for (const [i, c] of demo.contractors.entries()) {
      await page.getByRole("button", { name: "Add contractor" }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.getByLabel("Name").fill(c.name);
      await dialog.getByLabel("Email").fill(c.email);
      await dialog.getByLabel("Unified address").fill(addresses[i]);
      await dialog.getByRole("button", { name: "Add contractor" }).click();
      await expect(dialog).toBeHidden({ timeout: 60_000 });
      await expect(page.getByText(c.name).filter({ visible: true }).first()).toBeVisible();
    }
    const list = await api<{ contractors: { name: string; account_index: number }[] }>("/api/contractors");
    expect(list.contractors.map((c) => c.account_index)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  const runId = await timed(page, "create the run", async () => {
    await page.goto("/app/payer/runs/new");
    for (const c of demo.contractors) {
      await page.getByLabel(`Amount for ${c.name} (USD)`).fill(dollars(c.amount_usd_cents));
      await page.getByLabel(`Invoice reference for ${c.name}`).fill(c.invoice_ref);
    }
    await page.getByRole("button", { name: "Create run" }).click();
    await page.waitForURL(/\/app\/payer\/runs\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    return page.url().split("/").pop()!;
  });

  await timed(page, "fund (testnet fixed-rate venue)", async () => {
    await page.getByRole("button", { name: "Confirm funding" }).click();
    await expect(page.getByRole("button", { name: "Execute run" })).toBeVisible({ timeout: 120_000 });
  });

  await timed(page, "execute and wait for six confirmations", async () => {
    await page.getByRole("button", { name: "Execute run" }).click();
    await expect(page.getByText("Live updates on")).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => (await api<{ status: string }>(`/api/runs/${runId}`)).status, {
        timeout: 40 * 60_000,
        intervals: [5_000],
      })
      .toBe("paid");
    // The page reflects the paid run over SSE without a reload.
    await expect(page.getByText("6 of 6 payments confirmed on chain")).toBeVisible({ timeout: 60_000 });
  });

  type Line = {
    contractor_name: string;
    txid: string;
    confirmed_height: number;
    amount_usd_cents: number;
    invoice_ref: string;
  };
  const run = await api<{ lines: Line[]; allocation_txid: string; allocation_height: number }>(`/api/runs/${runId}`);

  await timed(page, "verify six txids and heights on a public explorer", async () => {
    expect(run.lines).toHaveLength(6);
    for (const l of run.lines) {
      expect(l.txid).toMatch(/^[0-9a-f]{64}$/);
      expect(l.confirmed_height).toBeGreaterThan(startTip);
      const tx = (await (await fetch(`${EXPLORER_API}/${l.txid}`)).json()) as { blockHeight?: string | number };
      expect(Number(tx.blockHeight), `${l.contractor_name} ${l.txid}`).toBe(l.confirmed_height);
      // The run page shows the truncated txid of every line.
      await expect(page.getByText(l.txid.slice(0, 8)).filter({ visible: true }).first()).toBeVisible();
    }
  });

  const first = run.lines[0];
  await timed(page, "contractor statement from one viewing key", async () => {
    await page.goto("/app/payer/contractors");
    await page.getByRole("button", { name: "Share viewing key" }).first().click();
    const key = await page.getByRole("dialog").getByLabel("Unified full viewing key").inputValue();
    expect(key).toMatch(/^uvftest1/);
    await page.goto("/app/contractor");
    await page.getByLabel("Viewing key").fill(key);
    await page.getByRole("button", { name: "Show statement" }).click();
    await expect(page.locator("#statement-title")).toContainText(first.contractor_name, { timeout: 180_000 });
    await expect(page.getByText(first.invoice_ref).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText(first.txid.slice(0, 8)).filter({ visible: true }).first()).toBeVisible();
  });

  await timed(page, "accountant reconciliation from the exported key file", async () => {
    await page.goto("/app/payer/contractors");
    await page.getByRole("button", { name: "Export all viewing keys for accountant" }).click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download JSON" }).click();
    const file = join(test.info().outputDir, "viewing-keys.json");
    await (await download).saveAs(file);
    await page.goto("/app/accountant");
    await page.getByRole("tab", { name: "Import file" }).click();
    await page.locator('input[type="file"]').setInputFiles(file);
    await page.getByRole("button", { name: /^Reconcile 7 keys$/ }).click();
    await expect(page.locator("#recon-title")).toBeVisible({ timeout: 300_000 });
    const runRow = page
      .getByRole("region", { name: "Run reconciliation" })
      .getByRole("row")
      .filter({ hasText: runId.slice(0, 6) });
    await expect(runRow).toContainText("Reconciled");
  });

  await timed(page, "CSV export", async () => {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    const file = join(test.info().outputDir, "reconciliation.csv");
    await (await download).saveAs(file);
    const csv = readFileSync(file, "utf8");
    for (const l of run.lines) expect(csv).toContain(l.txid);
    expect(csv).toContain("reconciled");
  });

  const report = {
    run_id: runId,
    allocation: { txid: run.allocation_txid, height: run.allocation_height },
    lines: run.lines.map((l) => ({ name: l.contractor_name, txid: l.txid, height: l.confirmed_height })),
    seconds: timings,
  };
  writeFileSync(join(test.info().outputDir, "demo-run.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
});
