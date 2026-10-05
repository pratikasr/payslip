/*
  The landing page (/): every section renders, the product accordion opens each item and swaps
  its card, the phone menu works, and every transaction link opens the testnet explorer.

  The page is static, so only the web app needs to be running (E2E_BASE_URL).
  Run: pnpm exec playwright test e2e/landing.spec.ts
*/
import { expect, test } from "@playwright/test";

const EXPLORER_TX = /^https:\/\/testnet\.zecblock\.com\/tx\/([0-9a-f]{64})$/;

const ACCORDION = [
  { title: "Shielded payroll runs", card: /^Sep 2026 payroll, run 284c2421/ },
  { title: "Payslips your contractors can prove", card: /^Payslip for Amara Okafor, verified on Zcash$/ },
  { title: "Books your accountant can reconcile", card: /^Reconciliation of run 284c2421/ },
  { title: "Open source, MIT", card: /repository on GitHub/ },
];

test("every section is present", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Radically private payroll" })).toBeVisible();
  for (const name of [
    /^Everything payroll needs\.\s*Nobody else sees it\.$/,
    /^Real payments, on a real chain\./,
    "Three steps from USDC to payslips",
    "Who sees what",
    "Security model, in four lines",
    "Pricing",
    "Questions, answered",
    "Private to the world, transparent to your accountant.",
  ]) {
    await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
  }

  // The nav's anchors land on sections.
  const nav = page.getByRole("navigation", { name: "Main" });
  for (const [label, id] of [
    ["Product", "product"],
    ["How it works", "how-it-works"],
    ["Security", "security"],
    ["Pricing", "pricing"],
  ]) {
    await expect(nav.getByRole("link", { name: label })).toHaveAttribute("href", `#${id}`);
    await expect(page.locator(`#${id}`)).toBeAttached();
  }

  // Hero: both calls to action, the disclaimer, and a payroll whose amounts stay sealed.
  const main = page.getByRole("main");
  await expect(main.getByRole("link", { name: "Try the live demo" }).first()).toHaveAttribute("href", "/console");
  await expect(main.getByRole("link", { name: "Check a payslip" })).toHaveAttribute("href", "/verify");
  await expect(page.getByText("Payslip is open-source software, not a bank.")).toBeVisible();
  const sealed = page.getByRole("figure", { name: "Sep 2026 payroll", exact: true });
  await expect(sealed).toContainText("Amara Okafor");
  await expect(sealed.getByText("Amount sealed")).toHaveCount(4);
  await expect(sealed).not.toContainText("$");

  // Who sees what: four parties, three columns.
  const table = page.getByRole("table", { name: "What each party holds, sees and cannot see" });
  await expect(table.getByRole("columnheader")).toHaveText(["Party", "Holds", "Sees", "Cannot see"]);
  await expect(table.getByRole("rowheader")).toHaveText(["Company", "Contractor", "Accountant", "Everyone else"]);

  // Pricing tiers and the comparison line.
  const pricing = page.locator("#pricing");
  await expect(pricing.getByRole("heading", { level: 3 })).toHaveText(["Self-hosted", "Hosted", "Accountant"]);
  await expect(pricing).toContainText("Deel and Rise list $49 per contractor per month");

  // The FAQ is always expanded: six questions, every answer on the page.
  const faq = page.locator("#faq");
  await expect(faq.locator("dt")).toHaveCount(6);
  for (const answer of await faq.locator("dd").all()) await expect(answer).toBeVisible();

  // Footer: the four columns and the hackathon note.
  const footer = page.getByRole("contentinfo");
  for (const col of ["Product", "Docs on GitHub", "Security", "License"]) {
    await expect(footer.getByRole("navigation", { name: col })).toBeVisible();
  }
  await expect(footer).toContainText("Zcash track");
});

test("the product accordion opens each item and swaps its card", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  const section = page.locator("#product");

  for (let i = 0; i < ACCORDION.length; i++) {
    const button = section.getByRole("button", { name: ACCORDION[i].title });
    if (i > 0) await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(section.getByRole("region", { name: ACCORDION[i].title })).toBeVisible();
    await expect(section.getByRole("figure", { name: ACCORDION[i].card })).toBeVisible();
    for (let j = 0; j < ACCORDION.length; j++) {
      if (j === i) continue;
      await expect(section.getByRole("button", { name: ACCORDION[j].title })).toHaveAttribute("aria-expanded", "false");
      await expect(section.getByRole("region", { name: ACCORDION[j].title })).toBeHidden();
      await expect(section.getByRole("figure", { name: ACCORDION[j].card })).toBeHidden();
    }
  }

  // Activating the open item closes it.
  const last = section.getByRole("button", { name: ACCORDION[3].title });
  await last.click();
  await expect(last).toHaveAttribute("aria-expanded", "false");
  await expect(section.getByRole("region", { name: ACCORDION[3].title })).toBeHidden();

  // By keyboard too.
  const first = section.getByRole("button", { name: ACCORDION[0].title });
  await first.focus();
  await page.keyboard.press("Enter");
  await expect(first).toHaveAttribute("aria-expanded", "true");
});

test("on a phone the card sits inside the open item", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const section = page.locator("#product");
  await section.getByRole("button", { name: ACCORDION[2].title }).click();
  const region = section.getByRole("region", { name: ACCORDION[2].title });
  await expect(region.getByRole("figure", { name: ACCORDION[2].card })).toBeVisible();
  await expect(region).toContainText("Reconciled");
});

test("the phone menu opens, jumps to a section and closes", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  const button = page.getByRole("button", { name: "Menu" });
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(nav).toBeHidden();

  await button.click();
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(nav.getByRole("link")).toHaveText(["Product", "How it works", "Security", "Pricing", /^GitHub/]);
  const panel = page.locator(`[id="${await button.getAttribute("aria-controls")}"]`);
  await expect(panel.getByRole("link", { name: "Try the live demo" })).toHaveAttribute("href", "/console");
  await expect(panel.getByRole("link", { name: "Check a payslip" })).toHaveAttribute("href", "/verify");

  // Escape closes it and puts focus back on the button.
  await page.keyboard.press("Escape");
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(button).toBeFocused();

  // Choosing a section closes it and scrolls there.
  await button.click();
  await nav.getByRole("link", { name: "Pricing" }).click();
  await expect(button).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("heading", { level: 2, name: "Pricing" })).toBeInViewport();

  // No sideways scrolling on a 375px screen.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0);
});

test("every transaction link opens the testnet explorer", async ({ page }) => {
  await page.goto("/");
  const links = await page.locator("a[href]").evaluateAll((as) =>
    as.map((a) => ({
      href: a.getAttribute("href") ?? "",
      target: a.getAttribute("target"),
      txid: a.getAttribute("data-txid"),
    })),
  );
  const txLinks = links.filter((l) => l.txid !== null || /[0-9a-f]{64}/.test(l.href));
  // Hero (4), payslip card (1), the two rehearsals (12) and the USDC conversion (1).
  expect(txLinks.length).toBeGreaterThanOrEqual(18);
  for (const l of txLinks) {
    const m = EXPLORER_TX.exec(l.href);
    expect(m, `${l.href} is not a testnet explorer link`).not.toBeNull();
    expect(l.txid).toBe(m![1]);
    expect(l.target).toBe("_blank");
  }
  // Every rehearsal payment listed in the proof strip is linked.
  const proof = page.locator("#proof a[data-txid]");
  await expect(proof).toHaveCount(13);
});
