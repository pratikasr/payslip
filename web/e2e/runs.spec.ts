/*
  Payroll runs in the company console: the runs list, a paid run's page (tabs and the payment
  drawer) and the run payroll flow up to the Review step, with its validation. Read-only: the
  flow is never approved, and the test checks that no run was created.

  Needs the testnet service and the web app running, with at least one contractor and one paid
  run (E2E_API_URL, E2E_BASE_URL). Run: pnpm exec playwright test e2e/runs.spec.ts
*/
import { expect, test } from "@playwright/test";

const API = (process.env.E2E_API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");

interface Line {
  contractor_name: string;
  amount_usd_cents: number;
  txid: string | null;
  confirmed_height: number | null;
  status: string;
}
interface Run {
  id: string;
  status: string;
  period_label: string;
  period_start: string;
  period_end: string;
  created_at: string;
  lines: Line[];
}

/** Latest pay period first, as the console orders every list (never by creation time). */
const byPeriod = (a: Run, b: Run) =>
  b.period_end.localeCompare(a.period_end) ||
  b.period_start.localeCompare(a.period_start) ||
  b.created_at.localeCompare(a.created_at);

/** The period Run payroll proposes: from the day after the latest paid run to that month's end. */
function nextPeriodKey(runs: Run[]): string | null {
  const covered = runs
    .filter((r) => ["paid", "funded", "swapping", "swapped", "allocating", "paying"].includes(r.status))
    .sort(byPeriod)[0];
  if (!covered) return null;
  const next = new Date(Date.parse(`${covered.period_end}T00:00:00Z`) + 86_400_000);
  return next.getUTCDate() === 1 ? next.toISOString().slice(0, 7) : "custom";
}
interface Contractor {
  id: string;
  name: string;
  account_index: number;
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${API}${path}`);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const periodLabel = (label: string) => `${MONTHS[Number(label.slice(5, 7)) - 1]} ${label.slice(0, 4)}`;
const dollars = (cents: number) =>
  `${Math.floor(cents / 100).toLocaleString("en-US")}.${String(cents % 100).padStart(2, "0")}`;

async function paidRun(): Promise<Run> {
  const { runs } = await get<{ runs: Run[] }>("/api/runs");
  const run = runs.find((r) => r.status === "paid" && r.lines.length > 0);
  test.skip(!run, "Needs a paid run on the service");
  return run!;
}

test.describe("payroll runs", () => {
  test("the runs list shows every run with status chips and links to each run", async ({ page }) => {
    const { runs } = await get<{ runs: Run[] }>("/api/runs");
    test.skip(runs.length === 0, "Needs at least one run");
    await page.goto("/console/runs");
    await expect(page.getByRole("heading", { level: 1, name: "Payroll runs" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Run payroll" }).first()).toBeVisible();

    const chips = page.getByRole("group", { name: "Filter runs by status" });
    await expect(chips.getByRole("button", { name: new RegExp(`^All ${runs.length}$`) })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const paid = runs.filter((r) => r.status === "paid").length;
    if (paid > 0) await expect(chips.getByRole("button", { name: new RegExp(`^Paid ${paid}$`) })).toBeVisible();

    const rows = page.locator("tbody tr");
    await expect(rows).toHaveCount(runs.length);

    // A filter shows only where there is something in it; Failed filters to failed runs.
    const failed = runs.filter((r) => r.status === "failed").length;
    if (failed === 0) await expect(chips.getByRole("button", { name: /^Failed/ })).toHaveCount(0);
    else {
      await chips.getByRole("button", { name: /^Failed/ }).click();
      await expect(rows).toHaveCount(failed);
      await chips.getByRole("button", { name: /^All/ }).click();
    }

    // The whole row is a link to the run page.
    const run = runs.find((r) => r.status === "paid") ?? runs[0];
    await page.locator(`a[href="/console/runs/${run.id}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`/console/runs/${run.id}$`));
  });

  test("a paid run's page has its figures, pay lines, drawer, privacy view and audit trail", async ({ page }) => {
    const run = await paidRun();
    await page.goto(`/console/runs/${run.id}`);
    const title = periodLabel(run.period_label);

    await expect(page.getByRole("heading", { level: 1 })).toContainText(`${title} payroll`);
    await expect(page.getByRole("heading", { level: 1 }).getByText("Paid")).toBeVisible();
    await expect(page.getByRole("button", { name: /Simulated rate/ }).first()).toBeVisible();
    // The simulated rate's number is in its note, never in the figures on the page.
    await expect(page.getByText(/1,350,000/)).toHaveCount(0);
    await page
      .getByRole("button", { name: /Simulated rate/ })
      .first()
      .click();
    await expect(page.getByText("A simulated testnet rate")).toBeVisible();
    await page.keyboard.press("Escape");

    // Above the tabs: the run in two views, what the explorer shows beside what the payer's keys
    // read, joined by each transaction id, with a way into the Privacy view.
    const views = page.getByRole("figure", {
      name: `The ${title} payroll in two views: what the Zcash explorer shows, and what your keys show.`,
    });
    const vault = views.getByRole("group", { name: "What the explorer shows" });
    const paper = views.getByRole("group", { name: "What your keys show" });
    await expect(vault.getByText(/^\d+ shielded transactions?\. No amounts, no names\.$/)).toBeVisible();
    const sentLine = run.lines.find((l) => l.txid)!;
    for (const side of [vault, paper]) await expect(side).toContainText(sentLine.txid!.slice(0, 6));
    for (const secret of [sentLine.contractor_name, "$"]) await expect(vault).not.toContainText(secret);
    await expect(paper).toContainText(sentLine.contractor_name);
    // A paid run needs no action card.
    await expect(page.getByRole("link", { name: /^(Resume|Fund run|Follow progress)$/ })).toHaveCount(0);

    // Pay lines: one row per line, each with its txid and block.
    const tab = page.getByRole("tab", { name: /Pay lines/ });
    await expect(tab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("tbody tr")).toHaveCount(run.lines.length);
    const line = run.lines.find((l) => l.status === "confirmed" && l.txid)!;
    await expect(page.getByText(dollars(line.amount_usd_cents).split(".")[0]).first()).toBeVisible();

    // The drawer: amount, timeline to the confirming block, explorer link; Escape closes it.
    await page.getByRole("button", { name: line.contractor_name, exact: true }).click();
    const drawer = page.getByRole("dialog", { name: `Payment to ${line.contractor_name}` });
    await expect(drawer).toBeVisible();
    await expect(
      drawer.getByText(`Confirmed in block ${line.confirmed_height!.toLocaleString("en-US")}`),
    ).toBeVisible();
    await expect(drawer.getByText("Sent as a shielded payment")).toBeVisible();
    await expect(drawer.getByRole("link", { name: /Open in explorer/ })).toHaveAttribute("href", /zecblock|explorer/);
    // The memo decoded, the raw text behind a disclosure, the account number under Technical details.
    const memo = drawer.getByRole("region", { name: "Encrypted memo" });
    await expect(memo.getByText(title, { exact: true })).toBeVisible();
    await expect(memo.getByText(/^PS1\|/)).toBeHidden();
    await memo.getByText("Show raw memo").click();
    await expect(memo.getByText(/^PS1\|/)).toBeVisible();
    await expect(drawer.getByText("Technical details")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    // Focus returns to the name that opened the drawer.
    await expect(page.getByRole("button", { name: line.contractor_name, exact: true })).toBeFocused();

    // Privacy view, from the two views: the public side is labelled an illustration; the Zcash side lists the real txids.
    await paper.getByRole("button", { name: "See the Privacy view" }).click();
    await expect(page.getByRole("tab", { name: "Privacy view" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("What a public chain would show")).toBeVisible();
    await expect(page.getByText("Illustration", { exact: true })).toBeVisible();
    await expect(page.getByText("What the Zcash explorer shows")).toBeVisible();
    await expect(page.locator(`code[title="${line.txid}"]`).first()).toBeVisible();
    await expect(page).toHaveURL(/#privacy$/);

    // Audit trail: funding, the move to each account, and the log in payroll words with the raw log behind a disclosure.
    await page.getByRole("tab", { name: "Audit trail" }).click();
    await expect(page.getByRole("heading", { name: "Activity" })).toBeVisible();
    await expect(page.getByText(/^Approved: \d+ payments? for /)).toBeVisible();
    await expect(page.getByText("Move to each account", { exact: true })).toBeVisible();
    await expect(page.getByText(`Paid ${line.contractor_name}`, { exact: false }).first()).toBeVisible();
    await page.getByText("Service log, as recorded").click();
    await expect(page.getByText(/^Run created with \d+ lines?$/)).toBeVisible();

    // The tab survives a reload through the URL hash.
    await page.reload();
    await expect(page.getByRole("tab", { name: "Audit trail" })).toHaveAttribute("aria-selected", "true");

    // The tab follows the address: a changed hash and the browser's Back both move it.
    await page.goto(`/console/runs/${run.id}`);
    await page.evaluate(() => {
      window.location.hash = "audit";
    });
    await expect(page.getByRole("tab", { name: "Audit trail" })).toHaveAttribute("aria-selected", "true");
    await page.goBack();
    await expect(page.getByRole("tab", { name: /Pay lines/ })).toHaveAttribute("aria-selected", "true");

    // A click on the Transaction cell (outside its buttons) opens the line like the rest of the row.
    await page.setViewportSize({ width: 1440, height: 900 });
    const cell = page.locator("tbody tr").first().locator("td").nth(4);
    const box = await cell.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2);
      await expect(page.getByRole("dialog", { name: /^Payment to / })).toBeVisible();
      await page.keyboard.press("Escape");
    }
  });

  test("the run payroll flow prefills amounts, validates, and reaches Review without creating a run", async ({
    page,
  }) => {
    const contractors = (await get<{ contractors: Contractor[] }>("/api/contractors")).contractors.sort(
      (a, b) => a.account_index - b.account_index,
    );
    test.skip(contractors.length === 0, "Needs at least one contractor");
    const all = (await get<{ runs: Run[] }>("/api/runs")).runs;
    const before = all.length;
    // Amounts come from the latest paid payroll by pay period, else the latest run with lines.
    const withLines = all.filter((r) => r.lines.length > 0 && r.status !== "cancelled").sort(byPeriod);
    const last = withLines.find((r) => r.status === "paid") ?? withLines[0];
    const proposed = nextPeriodKey(all);

    await page.goto("/console/runs/new");
    await expect(page.getByRole("heading", { level: 1, name: "Amounts" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Steps" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Close" })).toHaveAttribute("href", "/console/runs");

    // The period is the one after the latest paid payroll, not one already paid.
    if (proposed) await expect(page.getByRole("combobox", { name: "Pay period" })).toHaveValue(proposed);

    // Amounts come from that run; invoice references start blank.
    const first = last?.lines[0];
    if (first) {
      const c = contractors.find((x) => x.name === first.contractor_name)!;
      await expect(page.locator(`#amount-${c.id}`)).toHaveValue(dollars(first.amount_usd_cents));
      await expect(page.locator(`#invoice-${c.id}`)).toHaveValue("");
    }

    // Clearing empties every amount, and Continue then explains what is missing.
    if (last) await page.getByRole("button", { name: "Clear" }).click();
    const c0 = contractors[0];
    await page.locator(`#amount-${c0.id}`).fill("");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Enter an amount, or untick this contractor.").first()).toBeVisible();
    await expect(page.locator(`#amount-${c0.id}`)).toBeFocused();

    // Put the last run's amounts back (or type some) and continue.
    if (last) await page.getByRole("button", { name: /^Use .* amounts$/ }).click();
    for (const c of contractors) {
      const input = page.locator(`#amount-${c.id}`);
      if ((await input.isEnabled()) && !(await input.inputValue())) await input.fill("100");
    }

    // The invoice reference is required (it is sealed in the memo) and must be plain text.
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Add an invoice reference. It is sealed in the payment's memo.").first()).toBeVisible();
    await expect(page.locator(`#invoice-${c0.id}`)).toBeFocused();
    await page.locator(`#invoice-${c0.id}`).fill("INV|1");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(
      page.getByText("Use plain characters in the invoice reference: no |, no accented letters and no emoji."),
    ).toBeVisible();
    // "10,00" is refused, not read as a thousand dollars.
    await page.locator(`#amount-${c0.id}`).fill("10,00");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Use a dot for cents, like 10.00.")).toBeVisible();
    await page.locator(`#amount-${c0.id}`).fill("100");
    for (const c of contractors) {
      const input = page.locator(`#invoice-${c.id}`);
      if (await input.isEnabled()) await input.fill("E2E-REVIEW-ONLY");
    }
    // A period another run already covers needs a deliberate confirmation.
    const confirm = page.getByLabel(/This is an extra run for the same period/);
    if (await confirm.isVisible()) {
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByText("Tick the box to make an extra run, or choose another pay period.")).toBeVisible();
      await confirm.check();
    }
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(page).toHaveURL(/step=review/);
    await expect(page.getByRole("heading", { level: 1, name: /^Review payroll for / })).toBeVisible();
    await expect(page.getByText(/^Total for \d+ contractors?$/)).toBeVisible();
    await expect(page.getByText("From", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Contractors get", { exact: true }).first()).toBeVisible();
    await expect(page).toHaveTitle("Review and approve, Run payroll | Payslip");
    await expect(page.getByRole("button", { name: "Approve" })).toBeEnabled();
    await expect(page.getByText(/^By clicking Approve, I authorise Payslip/)).toBeVisible();

    // Review restates every line without a click (up to ten), and they fold away on request.
    const toggle = page.getByRole("button", { name: /contractors? for / });
    if (contractors.length <= 10) await expect(toggle).toHaveAttribute("aria-expanded", "true");
    else await toggle.click();
    await expect(page.locator("#review-lines")).toContainText("E2E-REVIEW-ONLY");

    // A reload keeps the draft (amounts and invoice references) on the Review step.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: /^Review payroll for / })).toBeVisible();
    if (contractors.length > 10) await page.getByRole("button", { name: /contractors? for / }).click();
    await expect(page.locator("#review-lines")).toContainText("E2E-REVIEW-ONLY");

    // Back returns to Amounts with what was typed.
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Amounts" })).toBeVisible();
    await expect(page.locator(`#invoice-${c0.id}`)).toHaveValue("E2E-REVIEW-ONLY");

    // Nothing was approved, so no run exists that did not exist before.
    expect((await get<{ runs: Run[] }>("/api/runs")).runs.length).toBe(before);
  });
});
