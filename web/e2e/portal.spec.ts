/*
  The contractor portal end to end: unlock with a pasted viewing key and with an invite link,
  the home page, a payslip as a document (and its print layout), the tax downloads, and Lock.
  Read-only: it creates nothing on chain.

  Needs the testnet service and the web app running (E2E_API_URL, E2E_BASE_URL) with at least one
  paid contractor. Run: pnpm exec playwright test e2e/portal.spec.ts
*/
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const API = (process.env.E2E_API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const SCAN = 180_000;

interface ExportedKey {
  role: string;
  ufvk: string;
  label: string;
  contractor_id: string | null;
}

async function contractorKey(): Promise<ExportedKey> {
  const keys = (await (await fetch(`${API}/api/viewing-keys`)).json()).keys as ExportedKey[];
  const key = keys.find((k) => k.role === "contractor");
  if (!key) throw new Error("The service has no contractor key. Add a contractor and pay a run first.");
  return key;
}

const firstName = (label: string) => label.trim().split(/\s+/)[0];

async function openWithInvite(page: Page, key: ExportedKey) {
  await page.goto(`/portal#key=${encodeURIComponent(key.ufvk)}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Welcome, ${firstName(key.label)}`, {
    timeout: SCAN,
  });
}

test("a contractor unlocks the portal by pasting their viewing key", async ({ page }) => {
  test.setTimeout(4 * 60_000);
  const key = await contractorKey();
  await page.goto("/portal");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Open your payslips");
  await expect(page.getByText("It cannot move money.")).toBeVisible();

  // An address is not a key, and the browser says so before anything is sent.
  const field = page.getByLabel("Viewing key");
  await field.fill(`utest1${"q".repeat(80)}`);
  await field.blur();
  await expect(page.getByText(/This is a payment address, not a viewing key/)).toBeVisible();

  await field.fill(key.ufvk);
  await page.getByRole("button", { name: "Open payslips" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Welcome, ${firstName(key.label)}`, {
    timeout: SCAN,
  });
  await expect(
    page.getByText("Your viewing key shows payments to you and nothing else. It cannot move money."),
  ).toBeVisible();

  // The key is kept for this tab only, and the contractor sees no company pages.
  expect(await page.evaluate(() => sessionStorage.getItem("payslip.portal.key"))).toBe(key.ufvk);
  expect(await page.evaluate(() => localStorage.getItem("payslip.portal.key"))).toBeNull();
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link")).toHaveText(["Home", "Payslips", "Tax documents"]);
});

test("an invite link unlocks the portal and the key leaves the address bar", async ({ page }) => {
  test.setTimeout(4 * 60_000);
  const key = await contractorKey();
  await openWithInvite(page, key);
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  expect(page.url()).not.toContain(key.ufvk.slice(0, 20));

  // Home: paid this year, the last payment with its privacy tag, and the latest payslips.
  const paid = page.getByRole("region", { name: /^Paid to you in \d{4}$/ });
  await expect(paid).toContainText(/\$[\d,]+\.\d{2}/);
  await expect(paid).toContainText("received");
  const last = page.getByRole("region", { name: "Last payment" });
  await expect(last.getByText(/^(Shielded|Converted to USDC)$/)).toBeVisible();
  await expect(
    page
      .getByRole("list", { name: "Latest payslips" })
      .getByRole("link", { name: /^Payslip for / })
      .first(),
  ).toBeVisible();

  // A bad invite link locks the portal and says why.
  await page.goto(`/portal#key=${encodeURIComponent("not a key")}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Open your payslips");
  await expect(page.getByText(/This invite link does not hold a viewing key/)).toBeVisible();
});

test("a payslip opens as a document that matches the chain and prints cleanly", async ({ page }) => {
  test.setTimeout(4 * 60_000);
  const key = await contractorKey();
  await openWithInvite(page, key);
  await page
    .getByRole("region", { name: "Last payment" })
    .getByRole("link", { name: /^Open the payslip for / })
    .click();
  await expect(page).toHaveURL(/\/portal\/payslips\/[0-9a-f]{64}$/);
  const txid = page.url().split("/").at(-1)!;
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Payslip for [A-Z][a-z]{2} \d{4}$/);

  // The figures on the page are the service's own, read with the same key.
  const now = new Date();
  const from = new Date(now.getTime() - 365 * 86_400_000).toISOString().slice(0, 10);
  const statement = await (
    await fetch(`${API}/api/statements/contractor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ufvk: key.ufvk, from, to: now.toISOString().slice(0, 10) }),
    })
  ).json();
  const line = statement.lines.find((l: { txid: string }) => l.txid === txid);
  expect(line).toBeTruthy();
  const doc = page.getByRole("article");
  await expect(doc).toContainText(txid);
  await expect(doc).toContainText(line.invoice_ref);
  await expect(doc).toContainText((line.height as number).toLocaleString("en-US"));
  const usd = (line.usd_basis_cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
  await expect(doc).toContainText(`$${usd}`);
  await expect(page.getByRole("button", { name: "Share proof" })).toBeEnabled();

  // Download PDF prints the document alone: no sidebar, no actions.
  await page.emulateMedia({ media: "print" });
  await expect(doc).toBeVisible();
  await expect(page.getByRole("button", { name: "Download PDF" })).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
  const docBox = await doc.boundingBox();
  expect(docBox!.width).toBeGreaterThan(500);
  await page.emulateMedia({ media: "screen" });
});

test("tax documents download as Payslip, Koinly and CoinTracker CSV, then Lock forgets the key", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  const key = await contractorKey();
  await openWithInvite(page, key);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Tax documents" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tax documents");
  const download = page.getByRole("button", { name: "Download" });
  await expect(download).toBeEnabled({ timeout: SCAN });

  const formats: [string, RegExp][] = [
    ["Payslip CSV", /^date,block_time,height,txid,amount_zec,usd_basis/],
    ["Koinly CSV", /^Date,Sent Amount,Sent Currency,Received Amount/],
    ["CoinTracker CSV", /^Date,Received Quantity,Received Currency/],
  ];
  for (const [label, header] of formats) {
    await download.click();
    const [file] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("menuitem", { name: new RegExp(`^${label}`) }).click(),
    ]);
    expect(file.suggestedFilename()).toMatch(/\.csv$/);
    const text = await readFile((await file.path())!, "utf8");
    expect(text.split(/\r?\n/)[0]).toMatch(header);
  }
  await download.click();
  await expect(page.getByRole("menuitem", { name: /^PDF/ })).toBeVisible();
  await page.keyboard.press("Escape");

  // Lock forgets the key; a reload stays locked.
  await page.getByRole("button", { name: "Lock" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Open your payslips");
  expect(await page.evaluate(() => sessionStorage.getItem("payslip.portal.key"))).toBeNull();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Open your payslips");
});
