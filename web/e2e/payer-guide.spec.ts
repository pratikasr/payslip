/*
  Setup guide, payroll insights and presenter mode. Read-only against the service: nothing is
  created, funded or sent; the only state written is the browser's own storage.

  Needs the testnet service and the web app running (E2E_API_URL, E2E_BASE_URL).
  Run: pnpm exec playwright test e2e/payer-guide.spec.ts
*/
import { expect, test } from "@playwright/test";

const API = (process.env.E2E_API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");

test("setup guide can be hidden, stays hidden after a reload, and comes back", async ({ page }) => {
  await page.goto("/app/payer", { waitUntil: "networkidle" });
  const guide = page.getByRole("region", { name: "Set up payroll" });
  test.skip(!(await guide.isVisible()), "This workspace has every setup step done, so no guide shows.");
  await expect(guide.getByRole("progressbar", { name: "Setup progress" })).toBeVisible();
  await guide.getByRole("button", { name: "Hide guide" }).click();
  await expect(guide).toBeHidden();
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("region", { name: "Set up payroll" })).toBeHidden();
  await page.getByRole("button", { name: "Show setup guide" }).click();
  await expect(page.getByRole("region", { name: "Set up payroll" })).toBeVisible();
});

test("the guide's Add a contractor link opens the dialog", async ({ page }) => {
  await page.goto("/app/payer/contractors?add=1", { waitUntil: "networkidle" });
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page).toHaveURL(/\/app\/payer\/contractors$/);
});

test("insights: figures match the API, the charts have a table twin and a keyboard readout", async ({ page }) => {
  const runs = (await (await fetch(`${API}/api/runs`)).json()).runs as {
    lines: { status: string; amount_usd_cents: number }[];
  }[];
  test.skip(runs.length === 0, "No runs on this service yet.");
  const paidCents = runs
    .flatMap((r) => r.lines)
    .reduce((s, l) => s + (l.status === "confirmed" ? l.amount_usd_cents : 0), 0);
  const paid = `$${Math.floor(paidCents / 100).toLocaleString("en-US")}.${String(paidCents % 100).padStart(2, "0")}`;

  await page.goto("/app/payer", { waitUntil: "networkidle" });
  const insights = page.getByRole("region", { name: "Payroll insights" });
  await expect(insights.getByText(paid).first()).toBeVisible();

  // Arrow keys move through the months and announce each one.
  await insights.getByRole("group", { name: /Payroll by period chart/ }).focus();
  await page.keyboard.press("End");
  await expect(insights.locator("[aria-live=polite]").first()).toContainText("paid");

  await insights.getByRole("button", { name: "Tables" }).click();
  await expect(insights.getByRole("region", { name: "Payroll by period" })).toBeVisible();
  await expect(insights.getByRole("region", { name: "Paid by contractor" })).toBeVisible();
});

test("presenter mode: ?present=1 turns it on for the tab, Alt+P turns it off", async ({ page }) => {
  await page.goto("/?present=1", { waitUntil: "networkidle" });
  const present = () => page.evaluate(() => document.documentElement.hasAttribute("data-present"));
  expect(await present()).toBe(true);
  await page.goto("/app/payer", { waitUntil: "networkidle" });
  expect(await present()).toBe(true);
  await page.keyboard.press("Alt+KeyP");
  expect(await present()).toBe(false);
  await page.reload({ waitUntil: "networkidle" });
  expect(await present()).toBe(false);
});
