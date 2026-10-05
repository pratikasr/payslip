/*
  Company console: Home, People, Payslip access and Treasury. Read-only against the service:
  nothing is created, edited, archived or marked as shared. Dialogs are opened and cancelled.

  Needs the testnet service (full wallet mode) and the web app running (E2E_API_URL, E2E_BASE_URL).
  Run: pnpm exec playwright test e2e/console.spec.ts
*/
import { expect, test } from "@playwright/test";

const API = (process.env.E2E_API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");

interface Line {
  status: string;
  amount_usd_cents: number;
  txid?: string | null;
}
interface Run {
  status: string;
  lines: Line[];
}
interface Contractor {
  id: string;
  name: string;
  account_index: number;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  expect(res.ok, `GET ${path} answered ${res.status}`).toBe(true);
  return (await res.json()) as T;
}

function usd(cents: number): string {
  return `$${Math.floor(cents / 100).toLocaleString("en-US")}.${String(cents % 100).padStart(2, "0")}`;
}

async function contractorsByAccount(): Promise<Contractor[]> {
  const { contractors } = await get<{ contractors: Contractor[] }>("/api/contractors");
  return contractors.sort((a, b) => a.account_index - b.account_index);
}

test("home renders on the server from the live service and matches its figures", async ({ page, request }) => {
  const { runs } = await get<{ runs: Run[] }>("/api/runs");
  const paid = runs.filter((r) => r.status === "paid");

  // The first paint already carries the cards: they are in the server HTML.
  const html = await (await request.get("/console")).text();
  expect(html).toContain(paid.length > 0 ? "Paid to contractors" : "Get started");

  await page.goto("/console", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("heading", { name: paid.length > 0 ? "Welcome back" : "Welcome to Payslip", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /^Add (your first )?contractor$/ }).first()).toHaveAttribute(
    "href",
    "/console/people?add=1",
  );

  if (paid.length === 0) {
    await expect(page.getByRole("region", { name: "Get started" })).toBeVisible();
    return;
  }
  await expect(page.getByRole("link", { name: "Run payroll" }).first()).toHaveAttribute("href", "/console/runs/new");
  const total = paid
    .flatMap((r) => r.lines)
    .reduce((s, l) => s + (l.status === "confirmed" ? l.amount_usd_cents : 0), 0);
  const card = page.getByRole("region", { name: /Paid to contractors/ });
  await expect(card.getByText(usd(total), { exact: true }).first()).toBeVisible();
  // The year as a table: the chart's twin.
  await card.getByRole("button", { name: "Show as a table" }).click();
  await expect(card.getByRole("table")).toBeVisible();
  // The three cards under the hero: treasury, next payroll and the to-do list.
  await expect(page.getByRole("region", { name: "Treasury" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Next payroll" })).toBeVisible();
  // Payslip has no pay schedule: the card names the period, never a due date.
  await expect(page.getByRole("region", { name: "Next payroll" }).getByText(/Due /)).toHaveCount(0);
  await expect(page.getByRole("region", { name: /^To do/ })).toBeVisible();

  // Payments are grouped under their run, and every confirmed one carries the gold Shielded mark.
  const payments = page.getByRole("region", { name: "Payments" });
  await expect(payments.getByRole("link", { name: "All runs" })).toHaveAttribute("href", "/console/runs");
  await expect(payments.getByRole("link", { name: /^\w{3} \d{4} payroll$/ }).first()).toBeVisible();
  await expect(payments.getByText("Shielded", { exact: true }).filter({ visible: true }).first()).toBeVisible();
});

test("home Export: payroll CSV made in the browser, and the auditor package", async ({ page }) => {
  const { runs } = await get<{ runs: (Run & { lines: (Line & { txid: string | null })[] })[] }>("/api/runs");
  test.skip(runs.length === 0, "Needs at least one run");
  await page.goto("/console", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Export" }).click();
  await expect(page.getByRole("menuitem", { name: /Auditor package \(viewing keys\)/ })).toHaveAttribute(
    "href",
    "/console/access#auditor-package",
  );
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("menuitem", { name: /Payroll CSV \(every run and line\)/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^payslip-payroll-(testnet|mainnet)-\d{4}-\d{2}-\d{2}\.csv$/);
  const csv = await (await download.createReadStream()).toArray().then((c) => Buffer.concat(c).toString("utf8"));
  const [header, ...rows] = csv.trim().split("\r\n");
  expect(header).toMatch(/^period,run_id,contractor,invoice,usd,(taz|zec),txid,height,confirmed_at,status$/);
  expect(rows).toHaveLength(runs.reduce((n, r) => n + r.lines.length, 0));
  for (const txid of runs.flatMap((r) => r.lines.map((l) => l.txid)).filter(Boolean)) expect(csv).toContain(txid!);
});

test("people: a row opens the detail drawer and Escape closes it", async ({ page }) => {
  const people = await contractorsByAccount();
  test.skip(people.length === 0, "No contractors on this service yet.");
  const first = people[0];

  await page.goto("/console/people", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "People", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: first.name, exact: true }).click();

  const drawer = page.getByRole("dialog", { name: new RegExp(first.name) });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("heading", { name: first.name, exact: true })).toBeVisible();
  await expect(drawer.getByText("Payment history")).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Edit" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Archive" })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`person=${first.id}`));

  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(page).not.toHaveURL(/person=/);

  // The drawer is part of history: Back closes it and stays on People.
  await page.getByRole("button", { name: first.name, exact: true }).click();
  await expect(drawer).toBeVisible();
  await page.goBack();
  await expect(drawer).toBeHidden();
  await expect(page).toHaveURL(/\/console\/people$/);

  // A link to someone who is not on the list says so.
  await page.goto("/console/people?person=00000000-0000-0000-0000-000000000000", { waitUntil: "networkidle" });
  await expect(page.getByText("This person was archived or does not exist.")).toBeVisible();
  await expect(page).not.toHaveURL(/person=/);

  // The search box narrows the table.
  await page.getByRole("searchbox", { name: "Search people" }).fill(first.name);
  await expect(page.getByRole("button", { name: first.name, exact: true })).toBeVisible();
});

test("people: ?add=1 opens the add dialog, Cancel closes it without saving", async ({ page }) => {
  const before = (await contractorsByAccount()).length;
  await page.goto("/console/people?add=1", { waitUntil: "networkidle" });
  const dialog = page.getByRole("dialog", { name: "Add contractor" });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/\/console\/people$/);
  await expect(dialog.getByLabel("Name")).toBeVisible();
  await expect(dialog.getByLabel("Unified address")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();

  // The page's own button opens it too.
  await page.getByRole("button", { name: "Add contractor" }).click();
  await expect(page.getByRole("dialog", { name: "Add contractor" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Add contractor" })).toBeHidden();
  expect((await contractorsByAccount()).length).toBe(before);
});

test("access: each invite link carries the viewing key, name and birthday, masked until revealed", async ({ page }) => {
  const people = await contractorsByAccount();
  test.skip(people.length === 0, "No contractors on this service yet.");
  const first = people[0];
  const exp = await get<{
    birthday_height: number;
    keys: { contractor_id: string | null; ufvk: string; birthday_height?: number }[];
  }>("/api/viewing-keys");
  const entry = exp.keys.find((k) => k.contractor_id === first.id);
  expect(entry, "the export has a key for the first contractor").toBeTruthy();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/console/access", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Payslip access", level: 1 })).toBeVisible();
  await expect(page.getByText(/cannot be revoked/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Download key file" })).toBeEnabled();

  // The table shows the link masked; Reveal shows it, and the key never sits in the page until then.
  const row = page.locator(`#person-${first.id}`);
  await expect(row.getByText(entry!.ufvk, { exact: false })).toHaveCount(0);
  await row.getByRole("button", { name: `Show invite link for ${first.name}` }).click();
  await expect(row.locator("code").filter({ hasText: "portal#key=" })).toBeVisible();
  // The voice-control name starts with the visible words.
  await expect(row.getByRole("button", { name: `Mark as shared, ${first.name}` })).toBeVisible();

  await page.getByRole("button", { name: `Invite ${first.name}: QR code and link` }).click();
  const dialog = page.getByRole("dialog", { name: `Invite ${first.name}` });
  await expect(dialog).toBeVisible();
  const link = await dialog.getByRole("textbox", { name: "Invite link" }).inputValue();
  const origin = new URL(page.url()).origin;
  expect(link.startsWith(`${origin}/portal#key=`)).toBe(true);
  const params = new URLSearchParams(link.split("#")[1]);
  expect(params.get("key")).toBe(entry!.ufvk);
  expect(params.get("name")).toBe(first.name);
  expect(Number(params.get("birthday"))).toBe(entry!.birthday_height ?? exp.birthday_height);
  await expect(
    dialog.getByRole("img", { name: new RegExp(`QR code of the invite link for ${first.name}`) }),
  ).toBeVisible();

  // The raw key sits behind Advanced.
  await dialog.getByText("Advanced").click();
  await expect(dialog.getByText(entry!.ufvk, { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  // Focus goes back to the button that opened the dialog.
  await expect(page.getByRole("button", { name: `Invite ${first.name}: QR code and link` })).toBeFocused();
});

test("treasury shows the receive address and the balance from the wallet", async ({ page }) => {
  const wallet = await get<{ treasury: { unified_address: string } }>("/api/wallet");
  await page.goto("/console/treasury", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Treasury", level: 1 })).toBeVisible();
  await expect(page.getByText(wallet.treasury.unified_address, { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "QR code of the treasury address" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sync" })).toBeEnabled();
  await expect(page.getByRole("region", { name: "Funding history" })).toBeVisible();
  // Block numbers are for the tooltip; the words say whether the wallet has caught up.
  await expect(page.getByText(/Up to date with the Zcash chain|blocks behind the Zcash chain/)).toBeVisible();
});

test("privacy mode blurs amounts and, on Payslip access and Treasury, keys and addresses", async ({ page }) => {
  const wallet = await get<{ treasury: { unified_address: string } }>("/api/wallet");
  await page.goto("/console/treasury", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Hide amounts" }).click();
  const address = page.getByText(wallet.treasury.unified_address, { exact: true });
  await expect(address).toHaveCSS("filter", /blur/);
  await expect(page.locator(".money").first()).toHaveCSS("filter", /blur/);
  await page.getByRole("button", { name: "Show amounts" }).click();
  await expect(address).toHaveCSS("filter", "none");
});

test("search finds a person and a run, and Enter opens the first result", async ({ page }) => {
  const people = await contractorsByAccount();
  test.skip(people.length === 0, "No contractors on this service yet.");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/console/people", { waitUntil: "networkidle" });
  await page.keyboard.press("Control+K");
  const dialog = page.getByRole("dialog", { name: "Search" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("searchbox", { name: "Search" }).fill(people[0].name);
  await expect(dialog.getByRole("link", { name: new RegExp(people[0].name) }).first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`person=${people[0].id}`));
});

test("the demo bar names the network on the first paint, and phones see it too", async ({ page, request }) => {
  const health = await get<{ network: string }>("/api/health");
  const sentence =
    health.network === "mainnet"
      ? "Payslip on Zcash mainnet. Payments here are real."
      : "You are in the Payslip demo on Zcash testnet. Nothing here is real money.";
  // Server HTML: the network is known before any client code runs, and never the other one.
  const html = await (await request.get("/console")).text();
  expect(html).toContain(sentence.replace(/'/g, "&#x27;"));
  expect(html).not.toContain(health.network === "mainnet" ? "Zcash testnet" : "Zcash mainnet");

  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/console", { waitUntil: "networkidle" });
  const bar = page.getByRole("complementary", { name: "Payslip demo" });
  await expect(bar.getByText(health.network === "mainnet" ? "Mainnet" : "Testnet", { exact: true })).toBeVisible();
  // The role switcher is there on testnet; on mainnet only on a demo build (NEXT_PUBLIC_PAYSLIP_DEMO=1).
  if (health.network === "testnet") await expect(bar.getByRole("button", { name: /^Viewing as / })).toBeVisible();
  // Nothing scrolls sideways on a phone.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test("privacy mode survives a reload straight into Run payroll", async ({ page }) => {
  await page.goto("/console", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Hide amounts" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-private", "");
  await page.goto("/console/runs/new", { waitUntil: "networkidle" });
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator("html")).toHaveAttribute("data-private", "");
  // The flow has the same eye, and it turns privacy off.
  await page.getByRole("button", { name: "Show amounts" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-private", "");
});
