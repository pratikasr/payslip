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

test("landing: skip link, then Launch app by keyboard", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.keyboard.press("Tab");
  expect(await focusedName(page)).toBe("Skip to content");
  expect(await focusVisible(page)).toBe(true);
  await tabTo(page, /^Launch app$/);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/app$/);
});

test("contractor statement with the keyboard alone", async ({ page }) => {
  const keys = (await (await fetch(`${API}/api/viewing-keys`)).json()).keys as {
    role: string;
    ufvk: string;
    label: string;
  }[];
  const contractor = keys.find((k) => k.role === "contractor")!;
  await page.goto("/app/contractor", { waitUntil: "networkidle" });
  await tabTo(page, /^Viewing key$/);
  await page.keyboard.insertText(contractor.ufvk);
  await tabTo(page, /^Show statement$/);
  await page.keyboard.press("Enter");
  await expect(page.locator("#statement-title")).toContainText(contractor.label, { timeout: 180_000 });
  // The export actions are reachable next.
  await tabTo(page, /Export CSV/);
});

test("Add contractor dialog: focus moves in, Escape closes, focus returns", async ({ page }) => {
  await page.goto("/app/payer/contractors", { waitUntil: "networkidle" });
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

test("new run form can be filled and its errors are announced", async ({ page }) => {
  await page.goto("/app/payer/runs/new", { waitUntil: "networkidle" });
  await tabTo(page, /^Amount for .* \(USD\)$/);
  await page.keyboard.insertText("0");
  await tabTo(page, /^Create run$/);
  await page.keyboard.press("Enter");
  // A zero amount is refused with an inline error linked to the field.
  const invalid = page.locator('[aria-invalid="true"]').first();
  await expect(invalid).toBeVisible();
  const describedBy = await invalid.getAttribute("aria-describedby");
  expect(describedBy).toBeTruthy();
  await expect(page.locator(`#${describedBy!.split(" ")[0]}`)).not.toBeEmpty();
});
