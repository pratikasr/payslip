/*
  Payment requests and the pay schedule (ADR-028), end to end against a service of their own:
  a contractor sends a request from the portal, the payer approves one and rejects another from
  the console queue, Run payroll offers the approved request as a prefilled line and the run
  takes it, and a pay schedule saved on its draft day drafts this month's payroll from default
  amounts. No coins are needed: nothing here funds or pays a run.

  Needs a fresh full-mode testnet service with sign-in off (PAYSLIP_AUTH unset) and the web app
  pointed at it. scripts/e2e-requests.sh starts both on ports of their own and runs this file.
  Without a fresh database the tests still run, but the schedule test needs no run to cover the
  current month yet.

  Settings: E2E_BASE_URL (web app), E2E_API_URL (service), E2E_CONTRACTOR_ADDRESSES (two or more
  testnet unified addresses, comma separated, used when the service has fewer than two people).
*/
import { expect, test, type Page } from "@playwright/test";

const API = (process.env.E2E_API_URL ?? "http://127.0.0.1:8093").replace(/\/+$/, "");
const ADDRESSES = (process.env.E2E_CONTRACTOR_ADDRESSES ?? "")
  .split(",")
  .map((a) => a.trim())
  .filter(Boolean);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface Contractor {
  id: string;
  name: string;
  account_index: number;
  default_amount_usd_cents?: number | null;
}
interface PaymentRequest {
  id: string;
  invoice_ref: string;
  status: string;
  run_id: string | null;
  recurring: string | null;
  decision_note: string | null;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${path}`, init);
  if (!r.ok) throw new Error(`${init?.method ?? "GET"} ${path}: HTTP ${r.status} ${await r.text()}`);
  // A discard answers 204 with no body.
  if (r.status === 204) return undefined as T;
  return (await r.json()) as T;
}

function post<T>(path: string, body: unknown, method = "POST"): Promise<T> {
  return api<T>(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

const stamp = Date.now().toString(36);
const INVOICE_A = `E2E-${stamp}-A`;
const INVOICE_B = `E2E-${stamp}-B`;

/** The previous calendar month (the period Run payroll proposes on a fresh service). */
function previousMonth(now = new Date()): { from: string; to: string; key: string; label: string } {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const key = first.toISOString().slice(0, 7);
  return {
    from: first.toISOString().slice(0, 10),
    to: last.toISOString().slice(0, 10),
    key,
    label: `${MONTHS[first.getUTCMonth()]} ${first.getUTCFullYear()}`,
  };
}

function thisMonth(now = new Date()): { from: string; to: string; label: string } {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return {
    from: first.toISOString().slice(0, 10),
    to: last.toISOString().slice(0, 10),
    label: `${MONTHS[first.getUTCMonth()]} ${first.getUTCFullYear()}`,
  };
}

/** "5 Oct 2026", as the app formats a date. */
function longDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

let people: Contractor[] = [];
let key = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const health = await api<{ mode?: string; auth?: string; network: string }>("/api/health");
  expect(health.mode ?? "full", "a full-mode service (it holds the payer wallet)").toBe("full");
  expect(health.auth ?? "off", "sign-in off: the console pages are opened without a session").toBe("off");
  let { contractors } = await api<{ contractors: Contractor[] }>("/api/contractors");
  if (contractors.length < 2) {
    expect(ADDRESSES.length, "E2E_CONTRACTOR_ADDRESSES must hold two testnet addresses").toBeGreaterThanOrEqual(2);
    for (const [i, address] of ADDRESSES.slice(0, 2 - contractors.length).entries()) {
      await post("/api/contractors", {
        name: `Request Tester ${String.fromCharCode(65 + contractors.length + i)}`,
        unified_address: address,
        settlement_choice: "hold_zec",
      });
    }
    contractors = (await api<{ contractors: Contractor[] }>("/api/contractors")).contractors;
  }
  people = contractors.sort((a, b) => a.account_index - b.account_index);
  key = (await api<{ ufvk: string }>(`/api/contractors/${people[0].id}/viewing-key`)).ufvk;
});

async function openPortal(page: Page) {
  await page.goto(`/portal#key=${encodeURIComponent(key)}&name=${encodeURIComponent(people[0].name)}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Welcome/);
}

test("portal: a contractor sends a request from the form and sees it as Sent", async ({ page }) => {
  const period = previousMonth();
  await openPortal(page);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Request a payment" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Request a payment");
  await expect(page).toHaveTitle("Request a payment | Payslip");

  // Nothing sent: the service refuses an empty form before any request leaves the browser.
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText("Enter the amount you are asking to be paid.")).toBeVisible();

  await page.getByLabel("Amount (USD)").fill("1,250.00");
  await page.getByLabel("Invoice number").fill(INVOICE_A);
  await page.getByLabel("Period").selectOption(period.key);
  await page.getByLabel("Note to your payer").fill("September retainer");
  await page.getByLabel("Repeat monthly").check();
  await page.getByRole("button", { name: "Send request" }).click();

  const item = page.getByRole("list", { name: "Your requests" }).locator("li", { hasText: INVOICE_A });
  await expect(item).toBeVisible();
  await expect(item.getByText("Sent", { exact: true })).toBeVisible();
  await expect(item).toContainText(period.label);
  await expect(item).toContainText("$1,250.00");
  await expect(item).toContainText("Repeats");
  // The form is clear for the next one.
  await expect(page.getByLabel("Amount (USD)")).toHaveValue("");

  const mine = await post<{ requests: PaymentRequest[] }>("/api/portal/requests/list", { ufvk: key });
  const sent = mine.requests.find((r) => r.invoice_ref === INVOICE_A);
  expect(sent?.status).toBe("submitted");
  expect(sent?.recurring).toBe("monthly");
});

test("console: the queue shows the request; one is approved with a note, another rejected", async ({ page }) => {
  const period = previousMonth();
  await post("/api/portal/requests", {
    ufvk: key,
    amount_usd_cents: 40_000,
    period_start: period.from,
    period_end: period.to,
    invoice_ref: INVOICE_B,
  });
  await page.goto("/console/requests", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1, name: "Payment requests" })).toBeVisible();
  // The sidebar counts what waits for a decision.
  const nav = page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: /^Requests/ });
  await expect(nav).toContainText(/\d+/);

  const rowA = page.locator("tbody tr", { hasText: INVOICE_A });
  await expect(rowA).toContainText(people[0].name);
  await expect(rowA).toContainText("$1,250.00");
  await expect(rowA.getByText("Sent", { exact: true })).toBeVisible();
  await rowA.getByRole("button", { name: `Approve, ${people[0].name} ${INVOICE_A}` }).click();
  const approve = page.getByRole("dialog", { name: new RegExp(`^Approve ${INVOICE_A}`) });
  await expect(approve).toBeVisible();
  await approve.getByLabel("Note to the contractor (optional)").fill("Thanks, it goes into September's run.");
  await approve.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(approve).toBeHidden();
  // The queue filter is "To review": the approved one has left it; the Approved filter shows it.
  await page.getByRole("button", { name: /^Approved/ }).click();
  const approvedRow = page.locator("tbody tr", { hasText: INVOICE_A });
  await expect(approvedRow.getByText("Approved", { exact: true })).toBeVisible();
  await expect(approvedRow).toContainText("Your note: Thanks");

  await page.getByRole("button", { name: /^To review/ }).click();
  const rowB = page.locator("tbody tr", { hasText: INVOICE_B });
  await rowB.getByRole("button", { name: `Reject, ${people[0].name} ${INVOICE_B}` }).click();
  const reject = page.getByRole("dialog", { name: new RegExp(`^Reject ${INVOICE_B}`) });
  await reject.getByLabel("Note to the contractor (optional)").fill("Not this month");
  await reject.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(reject).toBeHidden();
  await page.getByRole("button", { name: /^Rejected/ }).click();
  await expect(page.locator("tbody tr", { hasText: INVOICE_B }).getByText("Rejected", { exact: true })).toBeVisible();

  // The contractor sees both outcomes and the payer's note.
  await openPortal(page);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Request a payment" }).click();
  const list = page.getByRole("list", { name: "Your requests" });
  await expect(list.locator("li", { hasText: INVOICE_A }).getByText("Approved", { exact: true })).toBeVisible();
  const rejected = list.locator("li", { hasText: INVOICE_B });
  await expect(rejected.getByText("Rejected", { exact: true })).toBeVisible();
  await expect(rejected).toContainText("Your payer wrote: Not this month");
});

test("run payroll offers the approved request as a prefilled line and the run takes it", async ({ page }) => {
  const period = previousMonth();
  await page.goto("/console/runs/new");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Amounts");
  await page.getByRole("combobox", { name: "Pay period" }).selectOption(period.key);
  const mark = page.getByTestId(`from-request-${people[0].id}`);
  await expect(mark).toContainText("From a request");
  await expect(mark).toContainText(INVOICE_A);
  await expect(page.locator(`#amount-${people[0].id}`)).toHaveValue("1,250.00");
  await expect(page.locator(`#invoice-${people[0].id}`)).toHaveValue(INVOICE_A);
  // Only the person with the request is paid in this run.
  for (const c of people.slice(1)) await page.locator(`#include-${c.id}`).uncheck();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Review payroll for ${period.label}`);
  await expect(page.getByText("From a request")).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page).toHaveURL(/\?run=[0-9a-f-]{36}$/);
  const runId = new URL(page.url()).searchParams.get("run")!;

  const { requests } = await api<{ requests: PaymentRequest[] }>("/api/requests?status=approved");
  const taken = requests.find((r) => r.invoice_ref === INVOICE_A);
  expect(taken?.run_id).toBe(runId);
  // Discarding the draft gives the request back for the next run.
  await api(`/api/runs/${runId}`, { method: "DELETE", headers: { "Content-Type": "application/json" } });
  const after = await api<{ requests: PaymentRequest[] }>("/api/requests?status=approved");
  expect(after.requests.find((r) => r.invoice_ref === INVOICE_A)?.run_id).toBeNull();
});

test("settings: the pay schedule drafts this month's payroll from default amounts", async ({ page }) => {
  const month = thisMonth();
  const runsBefore = await api<{ runs: { period_start: string; status: string }[] }>("/api/runs");
  test.skip(
    runsBefore.runs.some((r) => r.status !== "cancelled" && r.period_start <= month.to && r.period_start >= month.from),
    "A run already covers this month on this service",
  );

  // A default amount from the person drawer, and one through the API.
  await page.goto(`/console/people?person=${people[0].id}`, { waitUntil: "networkidle" });
  const drawer = page.getByRole("dialog", { name: new RegExp(people[0].name) });
  await drawer.getByRole("button", { name: `Change default amount for ${people[0].name}` }).click();
  await drawer.getByLabel(`Default amount for ${people[0].name}, US dollars`).fill("900");
  await drawer.getByRole("button", { name: "Save", exact: true }).click();
  await expect(drawer.getByText("$900.00")).toBeVisible();
  await post(`/api/contractors/${people[1].id}`, { default_amount_usd_cents: 35_000 }, "PATCH");

  const today = new Date();
  const day = today.getUTCDate();
  await page.goto("/console/settings", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(page.getByTestId("schedule-none")).toBeVisible();
  await page.getByLabel("Cadence").selectOption("monthly");
  await page.getByLabel("Pay day", { exact: true }).selectOption(day <= 28 ? String(day) : "last");
  await page.getByLabel("Draft days before the pay day").fill("0");
  await page.getByRole("button", { name: "Set schedule" }).click();
  const status = page.getByTestId("schedule-status");
  await expect(status).toContainText("Monthly, paid on");
  await expect(status).toContainText("Drafted");
  await expect(status.getByRole("link", { name: `${month.label} payroll` })).toBeVisible();
  await expect(status).toContainText(`review by ${longDate(today.toISOString().slice(0, 10))}`);

  const schedule = await api<{ schedule: { drafted: { run_id: string; status: string } | null } }>("/api/schedule");
  expect(schedule.schedule.drafted?.status).toBe("draft");
  const run = await api<{ lines: { contractor_id: string; amount_usd_cents: number; invoice_ref: string }[] }>(
    `/api/runs/${schedule.schedule.drafted!.run_id}`,
  );
  const byPerson = new Map(run.lines.map((l) => [l.contractor_id, l]));
  expect(byPerson.get(people[0].id)?.amount_usd_cents).toBe(90_000);
  expect(byPerson.get(people[1].id)?.amount_usd_cents).toBe(35_000);
  expect(byPerson.get(people[0].id)?.invoice_ref).toBe(`${month.from} to ${month.to}`);

  // Home: the Next payroll card and the To do list read the schedule.
  await page.goto("/console", { waitUntil: "networkidle" });
  const next = page.getByRole("region", { name: "Next payroll" });
  await expect(next).toContainText(`${month.label} payroll`);
  await expect(next).toContainText("Drafted, review by");
  await expect(next.getByRole("link", { name: /^Review/ })).toHaveAttribute(
    "href",
    `/console/runs/new?run=${schedule.schedule.drafted!.run_id}`,
  );
  const todo = page.getByRole("region", { name: /^To do/ });
  await expect(todo).toContainText(`${month.label} payroll is drafted, review by`);
});
