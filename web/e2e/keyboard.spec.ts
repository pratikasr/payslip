/*
  Keyboard only: the main flows can be completed with Tab, Shift+Tab, Enter and Escape, every
  element that takes focus shows a visible indicator, and dialogs keep and return focus.

  Needs the testnet service and the web app running (E2E_API_URL, E2E_BASE_URL) with at least
  one contractor. Run: pnpm exec playwright test e2e/keyboard.spec.ts
*/
import { expect, test, type Page } from "@playwright/test";

const API = (process.env.E2E_API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");

/** True when the focused element shows an outline or a focus ring. */
async function focusVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return false;
    const s = getComputedStyle(el);
    const outline =
      s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0 && !/rgba\(\d+, \d+, \d+, 0\)/.test(s.outlineColor);
    // A ring is a box-shadow with a visible colour and a non-zero size.
    const ring = s.boxShadow
      .split(/,(?![^(]*\))/)
      .some((part) => !/rgba\(\d+, \d+, \d+, 0\)/.test(part) && /[1-9]\d*(\.\d+)?px/.test(part));
    return outline || ring;
  });
}

async function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return "";
    const label =
      el.getAttribute("aria-label") ?? (el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent : null);
    return (label ?? el.textContent ?? "").replace(/\s+/g, " ").trim();
  });
}

/** Presses Tab until the focused element's name matches, checking every stop shows focus. */
async function tabTo(page: Page, name: RegExp, max = 80): Promise<void> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const current = await focusedName(page);
    expect(await focusVisible(page), `no visible focus on "${current}"`).toBe(true);
    if (name.test(current)) return;
  }
  throw new Error(`could not reach ${name} with Tab`);
}

test("landing: skip link, then Try the live demo by keyboard", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.keyboard.press("Tab");
  expect(await focusedName(page)).toBe("Skip to content");
  expect(await focusVisible(page)).toBe(true);
  await tabTo(page, /^Try the live demo$/);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/console$/);
});

test("contractor portal unlocks with the keyboard alone", async ({ page }) => {
  const keys = (await (await fetch(`${API}/api/viewing-keys`)).json()).keys as {
    role: string;
    ufvk: string;
    label: string;
  }[];
  const contractor = keys.find((k) => k.role === "contractor")!;
  await page.goto("/portal", { waitUntil: "networkidle" });
  await tabTo(page, /^Viewing key$/);
  await page.keyboard.insertText(contractor.ufvk);
  await tabTo(page, /^Open payslips$/);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Welcome, /, { timeout: 180_000 });
  // A payslip is reachable next.
  await tabTo(page, /Payslip for /);
});

test("Add contractor dialog: focus moves in, Escape closes, focus returns", async ({ page }) => {
  await page.goto("/console/people", { waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "Add contractor" }).first()).toBeVisible();
  await tabTo(page, /^Add contractor$/);
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const inside = () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
  expect(await inside()).toBe(true);
  // Tab cycles within the dialog.
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press("Tab");
    expect(await inside(), "focus left the open dialog").toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  expect(await focusedName(page)).toMatch(/Add contractor/);
});

test("run payroll amounts can be filled and their errors are announced", async ({ page }) => {
  await page.goto("/console/runs/new", { waitUntil: "networkidle" });
  await tabTo(page, /^Amount for .*, US dollars$/);
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText("0");
  await tabTo(page, /^Continue$/);
  await page.keyboard.press("Enter");
  // A zero amount is refused with an inline error linked to the field.
  const invalid = page.locator('[aria-invalid="true"]').first();
  await expect(invalid).toBeVisible();
  const describedBy = await invalid.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  await expect(page.locator(`#${describedBy!.split(" ")[0]}`)).not.toBeEmpty();
});

test("person drawer: Enter opens it from the name, Escape closes it, focus returns to the name", async ({ page }) => {
  const { contractors } = (await (await fetch(`${API}/api/contractors`)).json()) as {
    contractors: { name: string; account_index: number }[];
  };
  test.skip(contractors.length === 0, "No contractors on this service yet.");
  const first = contractors.sort((a, b) => a.account_index - b.account_index)[0];
  await page.goto("/console/people", { waitUntil: "networkidle" });
  await tabTo(page, new RegExp(`^${first.name}$`));
  await page.keyboard.press("Enter");
  const drawer = page.getByRole("dialog", { name: new RegExp(first.name) });
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  // Focus moves back once the drawer has finished sliding out.
  await expect.poll(() => focusedName(page)).toBe(first.name);
});

test("run payroll: moving between steps puts focus on the new step's heading and names it in the title", async ({
  page,
}) => {
  const { contractors } = (await (await fetch(`${API}/api/contractors`)).json()) as {
    contractors: { id: string }[];
  };
  test.skip(contractors.length === 0, "No contractors on this service yet.");
  await page.goto("/console/runs/new", { waitUntil: "networkidle" });
  await expect(page).toHaveTitle("Amounts, Run payroll | Payslip");
  for (const c of contractors) {
    if (await page.locator(`#amount-${c.id}`).isEnabled()) {
      if (!(await page.locator(`#amount-${c.id}`).inputValue())) await page.locator(`#amount-${c.id}`).fill("100");
      await page.locator(`#invoice-${c.id}`).fill("E2E-KEYBOARD-ONLY");
    }
  }
  const extra = page.getByLabel(/This is an extra run for the same period/);
  if (await extra.isVisible()) await extra.check();
  await page.getByRole("button", { name: "Continue" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/step=review/);
  await expect(page.getByRole("heading", { level: 1, name: /^Review payroll for / })).toBeFocused();
  await expect(page).toHaveTitle("Review and approve, Run payroll | Payslip");
  await page.getByRole("button", { name: "Back", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Amounts" })).toBeFocused();
  await expect(page).toHaveTitle("Amounts, Run payroll | Payslip");
});
