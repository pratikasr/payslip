/*
  The landing page (/): every section is present in the order of docs/DESIGN.md section 16, the
  hero shows one real payment as its two copies (section 17: the yellow carbon the explorer shows
  inks out what the chain hides, the white pay advice the key reads shows it), the reveal plays
  once and not at all with reduced motion, every transaction
  link opens the testnet explorer, every focus stop shows, the phone menu works and the header
  stays reachable.

  The page is static; the calls to action ask the service which kind of deployment it is, so the
  web app (E2E_BASE_URL) and its service (E2E_API_URL) run.
  Run: pnpm exec playwright test e2e/landing.spec.ts
*/
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";


const EXPLORER_TX = /^https:\/\/testnet\.zecblock\.com\/tx\/([0-9a-f]{64})$/;
const MAINNET_EXPLORER_TX = "https://zecblock.com/tx/";

/** The payment the hero opens on: Biqtor's October pay on mainnet, the mainnet judge kit's proof. */
const HERO_TXID = "53f87ab55c51590a1ee38767ce1f45476ff0ee6347c005f00a1a6b48b838c8bc";

const docs = (...path: string[]) => JSON.parse(readFileSync(join(process.cwd(), "..", "docs", ...path), "utf8"));


test("every section is present, in order", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Private to the world. Transparent to your accountant.",
  );
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "Who sees what",
    "How a payroll run works",
    "Every payment, open to check",
    "Pricing",
    "Check it yourself",
  ]);

  // The nav's anchors land on sections.
  const nav = page.getByRole("navigation", { name: "Main" });
  for (const [label, id] of [
    ["How it works", "how-it-works"],
    ["Payments", "proof"],
    ["Pricing", "pricing"],
    ["Check it yourself", "check"],
  ]) {
    await expect(nav.getByRole("link", { name: label })).toHaveAttribute("href", `#${id}`);
    await expect(page.locator(`#${id}`)).toBeAttached();
  }

  // The entrances, named by who you are: the console for the company, the portal and Books for
  // the people it pays. Relative here, where no other host is configured.
  const main = page.getByRole("main");
  const doors = main.getByRole("navigation", { name: "Where to go" });
  await expect(doors.getByRole("link", { name: "Open the company console" })).toHaveAttribute("href", "/console");
  await expect(doors.getByRole("link", { name: "See your payslips" })).toHaveAttribute("href", "/portal");
  await expect(doors.getByRole("link", { name: "Open Books" })).toHaveAttribute("href", "/books");
  await expect(page.getByRole("banner").getByRole("link", { name: "Run payroll" })).toHaveAttribute("href", "/console");

  // The three people, each with a figure from the September run and the accounts their key opens.
  const people = page.locator("#who-sees-what");
  await expect(people.getByRole("heading", { level: 3 })).toHaveText([
    "The company",
    "The contractor",
    "The accountant",
  ]);
  for (const figure of ["$30,375.50", "$4,800.00", "$2,126.26"]) await expect(people).toContainText(figure);
  await expect(people.getByRole("img", { name: "Reads Amara Okafor's account only" })).toBeVisible();

  // How a run works: four steps, numbered because they are a sequence.
  await expect(page.locator("#how-it-works ol > li h3")).toHaveText([/Fund$/, /Allocate$/, /Pay$/, /Read back$/]);
  await expect(page.locator("#how-it-works")).toContainText(
    "PS1|09019bd8-d31d-400b-a779-050afeb3083e|2026-09|INV-2026-014|480000|1350000000000",
  );

  // Pricing against the $49 products.
  const pricing = page.locator("#pricing");
  await expect(pricing.getByRole("heading", { level: 3 })).toHaveText(["Payslip, hosted", "Deel and Rise"]);
  await expect(pricing).toContainText("$19");
  await expect(pricing).toContainText("$49");

  // Check it yourself: the judge kit's path and the app's own entry points.
  const check = page.locator("#check");
  await expect(check.getByRole("link", { name: /^docs\/judge\/judge-kit-mainnet\.json/ })).toHaveAttribute(
    "href",
    /\/blob\/main\/docs\/judge\/judge-kit-mainnet\.json$/,
  );
  await expect(check.getByRole("link", { name: /^docs\/judge\/judge-kit-testnet\.json/ })).toHaveAttribute(
    "href",
    /\/blob\/main\/docs\/judge\/judge-kit-testnet\.json$/,
  );
  await expect(check).toContainText("Choose Load the judge kit");
  await expect(check).toContainText("Try it with a demo key opens Amara Okafor's");
  await expect(check.getByRole("link", { name: "Open Books" })).toHaveAttribute("href", "/books");
  await expect(check.getByRole("link", { name: "Open the portal" })).toHaveAttribute("href", "/portal");
  await expect(check.getByRole("link", { name: "Check the proof" })).toHaveAttribute("href", /^\/verify#pp1/);

  // Footer: the three columns, the disclaimer and the hackathon note.
  const footer = page.getByRole("contentinfo");
  for (const col of ["Product", "Docs on GitHub", "License"]) {
    await expect(footer.getByRole("navigation", { name: col })).toBeVisible();
  }
  await expect(footer).toContainText("Payslip is open-source software, not a bank.");
  await expect(footer).toContainText("Zcash track");
});

test("the hero shows one payment in two copies", async ({ page }) => {
  await page.goto("/");
  const views = page.getByRole("figure", { name: /^One payment, two copies/ });
  const vault = views.getByRole("group", { name: "What the explorer sees" });
  const paper = views.getByRole("group", { name: "Pay advice" });

  // Both copies carry the same transaction, in the same block, at the same moment.
  for (const side of [vault, paper]) {
    await expect(side).toContainText(HERO_TXID.slice(0, 32));
    await expect(side).toContainText(HERO_TXID.slice(32));
    await expect(side).toContainText("3,514,845");
    await expect(side).toContainText("12 Oct 2026, 05:00 UTC");
  }

  // The explorer's copy inks out the employer, payee, period, invoice and amount, and names no one.
  await expect(vault).toContainText("2 actions");
  await expect(vault.getByText("Hidden on chain")).toHaveCount(5);
  for (const secret of ["$", "ZEC", "Biqtor", "Payslip Labs", "qwerty"]) {
    await expect(vault).not.toContainText(secret);
  }

  // The key's copy reads them.
  for (const value of ["$10.00", "0.00750999 ZEC", "Payslip Labs", "Biqtor", "qwerty"]) {
    await expect(paper).toContainText(value);
  }
  await expect(paper).not.toContainText("Hidden on chain");
  await expect(page.getByText("Payslip Labs on Zcash mainnet, 12 Oct 2026.")).toBeVisible();

  // Each copy links to its own check: the explorer, and the judge kit's proof of this payment.
  await expect(vault.getByRole("link", { name: /^Open it on zecblock\.com/ })).toHaveAttribute(
    "href",
    `${MAINNET_EXPLORER_TX}${HERO_TXID}`,
  );
  const kit = docs("judge", "judge-kit-mainnet.json") as { payment_proof: { txid: string; token: string } };
  expect(kit.payment_proof.txid).toBe(HERO_TXID);
  await expect(paper.getByRole("link", { name: "Check the payment proof" })).toHaveAttribute(
    "href",
    `/verify#${kit.payment_proof.token}`,
  );
});

/** Animations on the two copies (the ink lifting off the pay advice), finished or not. */
const panelAnimations = (page: Page) =>
  page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => ((a.effect as KeyframeEffect | null)?.target as Element | null)?.closest("figure"))
      .map((a) => a.playState),
  );

test("the reveal plays once, and not at all with reduced motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  expect(await panelAnimations(page)).toEqual([]);
  await expect(page.getByRole("group", { name: "Pay advice" })).toContainText("$10.00");

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.reload();
  expect((await panelAnimations(page)).length).toBeGreaterThan(0);
  await expect.poll(async () => (await panelAnimations(page)).every((s) => s === "finished")).toBe(true);
});

test("every transaction link opens its explorer", async ({ page }) => {
  await page.goto("/");
  const links = await page.locator("a[href]").evaluateAll((as) =>
    as.map((a) => ({
      href: a.getAttribute("href") ?? "",
      target: a.getAttribute("target"),
      txid: a.getAttribute("data-txid"),
    })),
  );
  const txLinks = links.filter((l) => l.txid !== null || /[0-9a-f]{64}/.test(l.href));
  // Hero (2), the allocation step (1), and the three runs' allocations (3) and payments (18).
  expect(txLinks.length).toBeGreaterThanOrEqual(24);
  // The hero's payment is on mainnet; the sample company's table is on testnet.
  for (const l of txLinks) {
    const m = EXPLORER_TX.exec(l.href) ?? new RegExp(`^${MAINNET_EXPLORER_TX}([0-9a-f]{64})$`).exec(l.href);
    expect(m, `${l.href} is not an explorer link`).not.toBeNull();
    expect(l.txid).toBe(m![1]);
    expect(l.target).toBe("_blank");
    if (l.href.startsWith(MAINNET_EXPLORER_TX)) expect(l.txid).toBe(HERO_TXID);
  }

  // Every transaction of the judge kit's wallet is in the payments table, and only those.
  const proof = page.locator("#proof a[data-txid]");
  await expect(proof).toHaveCount(21);
  const wallet = docs("proof", "demo-wallet-runs.json") as {
    runs: { allocation: { txid: string }; lines: { txid: string }[] }[];
  };
  const listed = new Set(await proof.evaluateAll((as) => as.map((a) => a.getAttribute("data-txid"))));
  for (const run of wallet.runs) {
    expect(listed.has(run.allocation.txid), run.allocation.txid).toBe(true);
    for (const line of run.lines) expect(listed.has(line.txid), line.txid).toBe(true);
  }
  await expect(page.locator("#proof")).toContainText("18 shielded payments and 3 allocations");
});

test("every focus stop on the page shows focus", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const seen = new Set<string>();
  for (let i = 0; i < 120; i++) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      // Next's dev-mode tools mount a custom element after the page; it is not part of the design.
      if (el.tagName.startsWith("NEXTJS")) return { path: "nextjs-dev-tools", visible: true };
      const s = getComputedStyle(el);
      const visible = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
      const index = [...document.querySelectorAll("a[href], button, [tabindex]")].indexOf(el);
      const path = `${index} ${el.tagName} ${(el.textContent ?? "").trim().slice(0, 40)}`;
      return { path, visible };
    });
    if (!stop || seen.has(stop.path)) break;
    seen.add(stop.path);
    expect(stop.visible, `no visible focus on ${stop.path}`).toBe(true);
  }
  expect(seen.size).toBeGreaterThan(40);
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
  await expect(nav.getByRole("link")).toHaveText([
    "How it works",
    "Payments",
    "Pricing",
    "Check it yourself",
    /^GitHub/,
  ]);
  const panel = page.locator(`[id="${await button.getAttribute("aria-controls")}"]`);
  await expect(panel.getByRole("link", { name: "Run payroll" })).toHaveAttribute("href", "/console");
  await expect(panel.getByRole("link", { name: "See your payslips" })).toHaveAttribute("href", "/portal");

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

test("the phone header stays reachable after scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.locator("#pricing").scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "Menu" })).toBeInViewport();
});
