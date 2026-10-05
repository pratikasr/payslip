/*
  Round 2: the 90-second demo script from docs/SPEC.md, walked through the UI against a real
  testnet service with a clean database. No mocks: every assertion is on data the chain returned.

  Prerequisites (see docs/TEST-REPORT.md, Round 2):
    - the service running on testnet with a clean data directory (scripts/fresh-testnet-env.sh)
    - the web app running (pnpm build && pnpm start)
    - E2E_BASE_URL (default http://127.0.0.1:3100) and E2E_API_URL (default http://127.0.0.1:8080)

  The path follows the redesigned app (docs/DESIGN.md section 15): People, the full-screen Run
  payroll flow with its review and approve step, the run page, an invite link into the contractor
  portal, and the accountant's Books.

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

test("demo script: onboard six, approve, fund, pay, portal, books, CSV", async ({ page }) => {
  test.setTimeout(45 * 60_000);
  const health = await api<{ network: string; chain_tip: number }>("/api/health");
  expect(health.network, "the demo rehearsal runs on testnet").toBe("testnet");
  const startTip = health.chain_tip;
  const existing = await api<{ contractors: unknown[] }>("/api/contractors");
  expect(existing.contractors, "start from a clean database").toHaveLength(0);
  const addresses = devAddresses();
  expect(addresses).toHaveLength(6);

  await timed(page, "onboard six contractors", async () => {
    await page.goto("/console/people");
    for (const [i, c] of demo.contractors.entries()) {
      await page.getByRole("button", { name: "Add contractor" }).first().click();
      const dialog = page.getByRole("dialog", { name: "Add contractor" });
      await dialog.getByLabel("Name").fill(c.name);
      await dialog.getByLabel("Email").fill(c.email);
      await dialog.getByLabel("Unified address").fill(addresses[i]);
      await dialog.getByRole("button", { name: "Add contractor" }).click();
      await expect(dialog).toBeHidden({ timeout: 60_000 });
      // Adding opens the new person's detail drawer; close it to return to the list.
      const drawer = page.getByRole("dialog", { name: new RegExp(c.name) });
      await expect(drawer).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden();
      await expect(page.getByRole("button", { name: c.name, exact: true })).toBeVisible();
    }
  });
  const people = (await api<{ contractors: { id: string; name: string; account_index: number }[] }>("/api/contractors"))
    .contractors;
  expect(people.map((c) => c.account_index).sort()).toEqual([1, 2, 3, 4, 5, 6]);

  const runId = await timed(page, "enter amounts, review and approve", async () => {
    await page.goto("/console/runs/new");
    await expect(page.getByRole("heading", { level: 1, name: "Amounts" })).toBeVisible({ timeout: 60_000 });
    for (const c of demo.contractors) {
      const id = people.find((p) => p.name === c.name)!.id;
      await page.locator(`#amount-${id}`).fill(dollars(c.amount_usd_cents));
      await page.locator(`#invoice-${id}`).fill(c.invoice_ref);
    }
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { level: 1, name: /^Review payroll for / })).toBeVisible();
    await expect(page.getByText("Total for 6 contractors")).toBeVisible();
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await page.waitForURL(/[?&]run=[0-9a-f-]{36}/, { timeout: 60_000 });
    return new URL(page.url()).searchParams.get("run")!;
  });

  await timed(page, "fund (testnet fixed-rate venue)", async () => {
    await page.getByRole("button", { name: "Fund from treasury" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^Fund \$/ })
      .click();
    await expect(page.getByRole("button", { name: "Pay 6 contractors" })).toBeVisible({ timeout: 180_000 });
  });

  await timed(page, "pay and wait for six confirmations", async () => {
    await page.getByRole("button", { name: "Pay 6 contractors" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: /^Pay \$/ })
      .click();
    await expect
      .poll(async () => (await api<{ status: string }>(`/api/runs/${runId}`)).status, {
        timeout: 40 * 60_000,
        intervals: [5_000],
      })
      .toBe("paid");
    // The flow reflects the paid run over SSE without a reload.
    await expect(page.getByText("Paid to 6 contractors")).toBeVisible({ timeout: 120_000 });
    await page.getByRole("link", { name: "View run" }).click();
    await page.waitForURL(new RegExp(`/console/runs/${runId}$`));
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
      // The run page shows every line's transaction.
      await expect(page.locator(`code[title="${l.txid}"]`).first()).toBeVisible();
    }
  });

  const first = run.lines[0];
  await timed(page, "contractor portal from an invite link", async () => {
    await page.goto("/console/access");
    await page.getByRole("button", { name: `Invite ${first.contractor_name}: QR code and link` }).click();
    const link = await page.getByRole("dialog").getByRole("textbox", { name: "Invite link" }).inputValue();
    expect(link).toMatch(/\/portal#key=/);
    await page.goto(link);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Welcome, /, { timeout: 180_000 });
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Payslips" }).click();
    await expect(page.getByText(first.invoice_ref).first()).toBeVisible({ timeout: 120_000 });
  });

  await timed(page, "accountant reconciliation with every key", async () => {
    await page.goto("/books");
    await page.getByRole("button", { name: "Load this company's keys" }).click();
    const row = page.getByTestId("books-run-row").filter({ hasText: /Reconciled/ });
    await expect(row.first()).toBeVisible({ timeout: 300_000 });
    await expect(page.getByTestId("books-runs")).toContainText(/Reconciled/);
  });

  await timed(page, "CSV export", async () => {
    await page.getByRole("link", { name: "Exports", exact: true }).first().click();
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 4 * 60_000 }),
      page.getByTestId("export-payslip").click(),
    ]);
    const file = join(test.info().outputDir, "reconciliation.csv");
    await download.saveAs(file);
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
