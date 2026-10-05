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
  await expect(page.getByRole("heading", { name: "Welcome back", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: "Run payroll" }).first()).toHaveAttribute("href", "/console/runs/new");
  await expect(page.getByRole("link", { name: "Add contractor" }).first()).toHaveAttribute(
    "href",
    "/console/people?add=1",
  );
  await expect(page.getByRole("link", { name: "Export" })).toHaveAttribute("href", "/console/access#auditor-package");

  if (paid.length === 0) {
    await expect(page.getByRole("region", { name: "Get started" })).toBeVisible();
    return;
  }
  const total = paid
    .flatMap((r) => r.lines)
    .reduce((s, l) => s + (l.status === "confirmed" ? l.amount_usd_cents : 0), 0);
  const card = page.getByRole("region", { name: /Paid to contractors/ });
  await expect(card.getByText(usd(total), { exact: true }).first()).toBeVisible();
  // The three cards under the hero: treasury, next payroll and the to-do list.
  await expect(page.getByRole("region", { name: "Treasury" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Next payroll" })).toBeVisible();
  await expect(page.getByRole("region", { name: /^To do/ })).toBeVisible();

  // Payment filters are client side; Recent lists the confirmed lines.
  const payments = page.getByRole("region", { name: "Payments" });
  await expect(payments.getByRole("button", { name: "Recent" })).toHaveAttribute("aria-pressed", "true");
  await payments.getByRole("button", { name: /^Failed/ }).click();
  await expect(payments.getByRole("button", { name: /^Failed/ })).toHaveAttribute("aria-pressed", "true");
  await payments.getByRole("button", { name: "Recent" }).click();
  await expect(payments.getByText("Every payment is shielded on Zcash")).toBeVisible();
  await expect(payments.getByText("Paid", { exact: true }).first()).toBeVisible();
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

test("access: each contractor's invite link carries their viewing key after /portal#key=", async ({ page }) => {
  const people = await contractorsByAccount();
  test.skip(people.length === 0, "No contractors on this service yet.");
  const first = people[0];
  const exp = await get<{ keys: { contractor_id: string | null; ufvk: string }[] }>("/api/viewing-keys");
  const ufvk = exp.keys.find((k) => k.contractor_id === first.id)?.ufvk;
  expect(ufvk, "the export has a key for the first contractor").toBeTruthy();

  await page.goto("/console/access", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Payslip access", level: 1 })).toBeVisible();
  await expect(page.getByText(/cannot be revoked/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Download key file" })).toBeEnabled();

  await page.getByRole("button", { name: `Invite ${first.name}: QR code and link` }).click();
  const dialog = page.getByRole("dialog", { name: `Invite ${first.name}` });
  await expect(dialog).toBeVisible();
  const link = await dialog.getByRole("textbox", { name: "Invite link" }).inputValue();
  const origin = new URL(page.url()).origin;
  expect(link.startsWith(`${origin}/portal#key=`)).toBe(true);
  expect(decodeURIComponent(link.slice(`${origin}/portal#key=`.length))).toBe(ufvk);
  await expect(
    dialog.getByRole("img", { name: new RegExp(`QR code of the invite link for ${first.name}`) }),
  ).toBeVisible();

  // The raw key sits behind Advanced.
  await dialog.getByText("Advanced").click();
  await expect(dialog.getByText(ufvk!, { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("treasury shows the receive address and the balance from the wallet", async ({ page }) => {
  const wallet = await get<{ treasury: { unified_address: string } }>("/api/wallet");
  await page.goto("/console/treasury", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "Treasury", level: 1 })).toBeVisible();
  await expect(page.getByText(wallet.treasury.unified_address, { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "QR code of the treasury address" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sync" })).toBeEnabled();
  await expect(page.getByRole("region", { name: "Funding history" })).toBeVisible();
});
