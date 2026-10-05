/*
  The accountant workspace (/books) end to end, read only. Keys come from the company's real
  export (GET /api/viewing-keys) and every figure on screen is checked against the same
  reconciliation fetched from the service. The test wallet may hold old test runs and test memos;
  they are real chain data and the assertions count them rather than assume a clean history.

  The judge kit tests run on any testnet service, full or statements-only: they load the published
  kit (web/public/judge-kit-testnet.json, the same file as docs/judge/judge-kit-testnet.json) and
  check that every payment carries the kit's names. The other tests need a full-mode service,
  whose company keys they load.

  Needs the testnet service (E2E_API_URL) and the web app (E2E_BASE_URL). Spends nothing.
  Run: pnpm exec playwright test e2e/books.spec.ts
*/
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const API = (process.env.E2E_API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const KIT_PATH = join(process.cwd(), "..", "docs", "judge", "judge-kit-testnet.json");
const PUBLIC_KIT_PATH = join(process.cwd(), "public", "judge-kit-testnet.json");

interface KitKey {
  label: string;
  role: "treasury" | "contractor";
  ufvk: string;
}

async function serviceMode(): Promise<string> {
  return (await (await fetch(`${API}/api/health`)).json()).mode ?? "full";
}

interface KeyEntry {
  label: string;
  role: "treasury" | "contractor";
  ufvk: string;
}
interface Line {
  run_id: string;
  label: string | null;
  account_index: number | null;
}
interface Run {
  run_id: string;
  status: string;
  lines: number;
  pending_lines?: number;
  difference_usd_cents?: number | null;
}
interface Recon {
  runs: Run[];
  lines: Line[];
  pending?: Line[];
  unlabelled: unknown[];
  totals: { funded_usd_cents: number; paid_usd_cents: number; variance_usd_cents: number; count: number };
}

test.describe.configure({ mode: "serial" });
test.setTimeout(5 * 60_000);

async function exportFile(): Promise<{ network: string; keys: KeyEntry[] }> {
  const res = await fetch(`${API}/api/viewing-keys`);
  expect(res.ok, "GET /api/viewing-keys").toBeTruthy();
  return res.json();
}

/** "$249,699.10" from cents, the way the page prints it (raised cents read as plain text). */
function usd(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

/** The period the page chose, from its tab storage, and the same reconciliation from the API. */
async function sameReconciliation(page: Page, ufvks: string[]): Promise<Recon> {
  const saved = await page.evaluate(() => sessionStorage.getItem("payslip.books"));
  expect(saved, "the workspace keeps its keys and period for the tab").toBeTruthy();
  const { period } = JSON.parse(saved!) as { period: { from: string; to: string } };
  const res = await fetch(`${API}/api/statements/accountant`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ufvks, from: period.from, to: period.to }),
  });
  expect(res.ok, "POST /api/statements/accountant").toBeTruthy();
  return res.json();
}

async function waitForBooks(page: Page) {
  await expect(page.getByTestId("books-scanning").or(page.getByTestId("books-headline"))).toBeVisible();
  await expect(page.getByTestId("books-headline")).toBeVisible({ timeout: 4 * 60_000 });
}

test("the judge kit the web app serves is the published one", () => {
  expect(readFileSync(PUBLIC_KIT_PATH, "utf8")).toBe(readFileSync(KIT_PATH, "utf8"));
});

test("the judge kit loads with one click and names every payment by its key file", async ({ page }) => {
  const kit = JSON.parse(readFileSync(KIT_PATH, "utf8")) as { birthday_height: number; keys: KitKey[] };
  let sent: { birthday_height?: number; ufvks: string[] } | null = null;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/api/statements/accountant")) sent = r.postDataJSON();
  });
  await page.goto("/books");
  await page.getByRole("button", { name: /^Load the judge kit/ }).click();
  await waitForBooks(page);

  // The kit's birthday goes with every scan, and the page says where the scan started.
  expect(sent!.birthday_height).toBe(kit.birthday_height);
  await expect(page.getByTestId("books-scan-meta")).toContainText(
    `scanned from block ${kit.birthday_height.toLocaleString("en-US")}`,
  );
  await expect(page.getByTestId("books-key-chip")).toContainText("7 keys · Treasury and 6 contractors");
  // Funding records were read, so no warning about the Treasury key, on any kind of deployment.
  await expect(page.getByText(/No funding record was found/)).toHaveCount(0);
  await expect(page.getByTestId("books-headline")).toContainText("every dollar accounted for");

  // Every payment in the ledger, the contractor filter and the exports carries a name.
  await page.getByRole("link", { name: "Ledger", exact: true }).first().click();
  await expect(page.getByTestId("ledger-row").first()).toBeVisible({ timeout: 60_000 });
  const names = kit.keys.filter((k) => k.role === "contractor").map((k) => k.label);
  const options = await page.getByTestId("ledger-contractor").locator("option").allInnerTexts();
  expect(options.slice(1).sort()).toEqual([...names].sort());
  await expect(page.getByTestId("ledger-table").getByText(/Unknown account|Unlabelled account/)).toHaveCount(0);
  await page.getByRole("link", { name: "Exports", exact: true }).first().click();
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 4 * 60_000 }),
    page.getByTestId("export-xero").click(),
  ]);
  const xero = readFileSync((await download.path())!, "utf8");
  expect(xero).not.toMatch(/,Contractor,/);
  for (const name of names) expect(xero).toContain(`,${name},`);
});

test("a key set missing contractors never reads as reconciled", async ({ page }) => {
  const kit = JSON.parse(readFileSync(KIT_PATH, "utf8")) as { keys: KitKey[] };
  await page.goto("/books");
  await page.getByLabel(/^Or paste viewing keys/).fill(
    kit.keys
      .slice(0, 3)
      .map((k) => k.ufvk)
      .join("\n"),
  );
  await page.getByRole("button", { name: "Add 3 keys" }).click();
  await waitForBooks(page);
  await expect(page.getByTestId("books-headline")).not.toContainText("every dollar accounted for");
  await expect(page.getByTestId("books-headline")).toContainText("accounts whose keys are not loaded");
  const table = page.getByTestId("books-runs");
  await expect(table.getByText("Keys missing").first()).toBeVisible();
  await table.getByTestId("books-run-row").first().getByRole("button").click();
  await expect(page.getByTestId("run-missing-keys").first()).toContainText("4 of the 6 accounts this run paid");

  // The service is asked to delete its read-only scan of these keys; the tab forgets them too.
  await page.getByRole("button", { name: "Manage" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Forget these keys on the service" }).click();
  await expect(page.getByText(/^The service (forgot these keys|held no scan of these keys)$/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Open the books" })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("payslip.books"))).toBeNull();
});

test("loads the company's keys with one button and reconciles every run", async ({ page }) => {
  test.skip((await serviceMode()) === "statements", "a statements-only service holds no company keys");
  const file = await exportFile();
  const ufvks = file.keys.map((k) => k.ufvk);
  const contractors = file.keys.filter((k) => k.role === "contractor").length;

  await page.goto("/books");
  await expect(page.getByRole("heading", { name: "Open the books" })).toBeVisible();
  await expect(page.getByText("Viewing keys read payments but cannot spend them.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Load this company's keys" }).click();
  await waitForBooks(page);

  // The key set in the sidebar says what was loaded.
  await expect(page.getByTestId("books-key-chip")).toContainText(`${file.keys.length} keys`);
  await expect(page.getByTestId("books-key-chip")).toContainText(`Treasury and ${contractors} contractors`);

  const r = await sameReconciliation(page, ufvks);
  const reconciled = r.runs.filter((x) => x.status === "reconciled").length;
  await expect(page.getByTestId("books-headline")).toContainText(
    reconciled === r.runs.length
      ? `${usd(r.totals.paid_usd_cents)} paid, every dollar accounted for`
      : `${reconciled} of ${r.runs.length} ${r.runs.length === 1 ? "run" : "runs"} reconciled`,
  );

  // KPI row: funded, paid and variance are the service's totals to the cent.
  await expect(page.getByTestId("kpi-funded")).toContainText(usd(r.totals.funded_usd_cents));
  await expect(page.getByTestId("kpi-paid")).toContainText(usd(r.totals.paid_usd_cents));
  await expect(page.getByTestId("kpi-paid")).toContainText(`${r.totals.count} payments`);
  await expect(page.getByTestId("kpi-variance")).toContainText(usd(r.totals.variance_usd_cents));
  await expect(page.getByTestId("kpi-explained")).toContainText("$");
  await expect(page.getByTestId("kpi-unexplained")).toContainText("$");

  // One row per run, and a cent of rounding is shown under Difference, never hidden.
  const table = page.getByTestId("books-runs");
  await expect(table.getByTestId("books-run-row")).toHaveCount(r.runs.length);
  const withinRounding = r.runs.filter((x) => x.status === "reconciled" && (x.difference_usd_cents ?? 0) !== 0);
  await expect(table.getByText("rounding", { exact: true })).toHaveCount(withinRounding.length);
  await expect(page.getByTestId("books-runs-total")).toContainText(usd(r.totals.paid_usd_cents));

  // Drill-down: the first run opens with its funding and its payments.
  const first = table.getByTestId("books-run-row").first().getByRole("button");
  await first.click();
  await expect(first).toHaveAttribute("aria-expanded", "true");
  const detail = page.locator(`#${await first.getAttribute("aria-controls")}`);
  await expect(detail).toBeVisible();
  await expect(detail.getByRole("region", { name: "Funding" })).toBeVisible();
  await expect(detail.getByText(/^Payments \(\d+\)$/)).toBeVisible();
  await first.click();
  await expect(detail).toBeHidden();
});

test("imports the company's key file and filters the ledger", async ({ page }, testInfo) => {
  test.skip((await serviceMode()) === "statements", "a statements-only service holds no company keys");
  const file = await exportFile();
  const path = testInfo.outputPath("payslip-viewing-keys.json");
  writeFileSync(path, JSON.stringify(file));

  await page.goto("/books");
  await page.getByTestId("books-setup-file").setInputFiles(path);
  await waitForBooks(page);
  await expect(page.getByTestId("books-key-chip")).toContainText(`${file.keys.length} keys`);
  const r = await sameReconciliation(
    page,
    file.keys.map((k) => k.ufvk),
  );

  // Moving between Books pages reuses the scan; the ledger lists every line, pending included.
  await page.getByRole("link", { name: "Ledger", exact: true }).first().click();
  await expect(page).toHaveURL(/\/books\/ledger$/, { timeout: 60_000 });
  const all = r.lines.length + (r.pending?.length ?? 0);
  await expect(page.getByTestId("ledger-count")).toHaveText(String(all));
  await expect(page.getByTestId("ledger-table").getByTestId("ledger-row")).toHaveCount(all);

  // Contractor filter.
  const person = r.lines.find((l) => l.label && l.label !== "Treasury")?.label;
  test.skip(!person, "no contractor payments in the period");
  await page.getByTestId("ledger-contractor").selectOption({ label: person! });
  const theirs = [...r.lines, ...(r.pending ?? [])].filter((l) => l.label === person).length;
  await expect(page.getByTestId("ledger-count")).toHaveText(String(theirs));

  // Run filter, combined with the contractor.
  const runId = r.lines.find((l) => l.label === person)!.run_id;
  await page.getByTestId("ledger-run").selectOption(runId);
  const inRun = [...r.lines, ...(r.pending ?? [])].filter((l) => l.label === person && l.run_id === runId).length;
  await expect(page.getByTestId("ledger-count")).toHaveText(String(inRun));

  // Status filter: pending lines only.
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByTestId("ledger-status").selectOption("pending");
  await expect(page.getByTestId("ledger-count")).toHaveText(String(r.pending?.length ?? 0));
  await page.getByTestId("ledger-status").selectOption("confirmed");
  await expect(page.getByTestId("ledger-count")).toHaveText(String(r.lines.length));
});

test("lists every exception and downloads the accounting exports", async ({ page }) => {
  test.skip((await serviceMode()) === "statements", "a statements-only service holds no company keys");
  const file = await exportFile();
  await page.goto("/books");
  await page.getByRole("button", { name: "Load this company's keys" }).click();
  await waitForBooks(page);
  const r = await sameReconciliation(
    page,
    file.keys.map((k) => k.ufvk),
  );

  // Exceptions: the unlabelled count, and every unlabelled row listed (never dropped).
  await page
    .getByRole("link", { name: /^Exceptions/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/books\/exceptions$/, { timeout: 60_000 });
  await expect(page.getByTestId("exceptions-count-unlabelled")).toHaveText(String(r.unlabelled.length));
  await expect(page.getByTestId("unlabelled-table").getByTestId("unlabelled-row")).toHaveCount(r.unlabelled.length);
  const noFunding = r.runs.filter((x) => x.status === "missing_funding_record").length;
  await expect(page.getByTestId("exceptions-count-no-funding")).toHaveText(String(noFunding));

  // Exports: each CSV comes from the service with the header its tool expects.
  await page.getByRole("link", { name: "Exports", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "Choose where your books live" })).toBeVisible({ timeout: 60_000 });
  const headers: Record<string, RegExp> = {
    xero: /^Date,Amount,Payee,Description,Reference\r?$/,
    quickbooks: /^Date,Description,Amount\r?$/,
    payslip: /^# reconciliation\r?$/,
  };
  for (const [format, header] of Object.entries(headers)) {
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 4 * 60_000 }),
      page.getByTestId(`export-${format}`).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    const text = readFileSync((await download.path())!, "utf8");
    const [line1, line2] = text.split("\n");
    expect(line1, `${format} header`).toMatch(header);
    if (format === "payslip") expect(line2).toContain("difference_usd");
  }
});

test("refuses a seed phrase and forgets the keys on request", async ({ page }) => {
  test.skip((await serviceMode()) === "statements", "a statements-only service holds no company keys");
  await page.goto("/books");
  const box = page.getByLabel(/^Or paste viewing keys/);
  await box.fill("abandon ability able about above absent absorb abstract absurd abuse access accident");
  await expect(page.getByText(/This looks like a spending key or seed phrase/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Add keys" })).toBeDisabled();

  const file = await exportFile();
  await box.fill(file.keys.map((k) => k.ufvk).join("\n"));
  await page.getByRole("button", { name: `Add ${file.keys.length} keys` }).click();
  await waitForBooks(page);

  await page.getByRole("button", { name: "Manage" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Viewing keys" });
  await expect(dialog.getByRole("list", { name: "Loaded viewing keys" }).getByRole("listitem")).toHaveCount(
    file.keys.length,
  );
  await dialog.getByRole("button", { name: "Forget all keys" }).click();
  await expect(page.getByRole("heading", { name: "Open the books" })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("payslip.books"))).toBeNull();
});
