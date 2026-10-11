/*
  The landing page (/): every section is present in the order of docs/DESIGN.md section 16, the
  hero shows one real payment in its two views (the explorer's hides what the chain hides, the
  key's reads it), the reveal plays once and not at all with reduced motion, every transaction
  link opens the testnet explorer, every focus stop shows, the phone menu works and the header
  stays reachable.

  The page is static; the calls to action ask the service which kind of deployment it is, so the
  web app (E2E_BASE_URL) and its service (E2E_API_URL) run.
  Run: pnpm exec playwright test e2e/landing.spec.ts
*/
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const API = (process.env.E2E_API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");

const EXPLORER_TX = /^https:\/\/testnet\.zecblock\.com\/tx\/([0-9a-f]{64})$/;

/** The payment the hero opens on: Amara Okafor's September pay, the judge kit's proof. */
const HERO_TXID = "b597daba92b76495421d44c22b7c6282ca8f053cad6de06fdcb648a01d2bf0c3";

const docs = (...path: string[]) => JSON.parse(readFileSync(join(process.cwd(), "..", "docs", ...path), "utf8"));

async function demoLink(): Promise<{ name: string; href: string }> {
  const mode = (await (await fetch(`${API}/api/health`)).json()).mode;
  return mode === "statements"
    ? { name: "Import the judge kit", href: "/books" }
    : { name: "Try the live demo", href: "/console" };
}

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

  // The calls to action: the console on a full deployment, Books and the judge kit on a
  // statements-only one.
  const main = page.getByRole("main");
  const demo = await demoLink();
  await expect(main.getByRole("link", { name: demo.name }).first()).toHaveAttribute("href", demo.href);
  await expect(main.getByRole("link", { name: "Check it yourself" })).toHaveAttribute("href", "#check");

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
  await expect(check.getByRole("link", { name: /^docs\/judge\/judge-kit-testnet\.json/ })).toHaveAttribute(
    "href",
    /\/blob\/main\/docs\/judge\/judge-kit-testnet\.json$/,
  );
  await expect(check).toContainText("Choose Load the judge kit");
  await expect(check).toContainText("Choose Try it with a demo key");
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

test("the hero shows one payment in two views", async ({ page }) => {
  await page.goto("/");
  const views = page.getByRole("figure", { name: /^One payment, two views/ });
  const vault = views.getByRole("group", { name: "What the explorer shows" });
  const paper = views.getByRole("group", { name: "What Amara's viewing key shows" });

  // Both views head with the same transaction, in the same block, at the same moment.
  for (const side of [vault, paper]) {
    await expect(side).toContainText(HERO_TXID.slice(0, 32));
    await expect(side).toContainText(HERO_TXID.slice(32));
    await expect(side).toContainText("4,466,912");
    await expect(side).toContainText("5 Oct 2026, 08:13 UTC");
  }

  // The explorer's view hides the amount, sender, recipient and memo, and names no one.
  await expect(vault).toContainText("2 actions");
  await expect(vault.getByText("Hidden on chain")).toHaveCount(6);
  for (const secret of ["$", "TAZ", "Amara", "Sample company", "INV-2026-014"]) {
    await expect(vault).not.toContainText(secret);
  }

  // The key's view reads them.
  for (const value of ["$4,800.00", "0.00355556 TAZ", "Sample company", "Amara Okafor", "INV-2026-014"]) {
    await expect(paper).toContainText(value);
  }
  await expect(paper).not.toContainText("Hidden on chain");
  await expect(page.getByText("Sample company on Zcash testnet.")).toBeVisible();

  // Each view links to its own check: the explorer, and the judge kit's proof of this payment.
  await expect(vault.getByRole("link", { name: /^Open it on testnet\.zecblock\.com/ })).toHaveAttribute(
    "href",
    `https://testnet.zecblock.com/tx/${HERO_TXID}`,
  );
  const kit = docs("judge", "judge-kit-testnet.json") as { payment_proof: { txid: string; token: string } };
  expect(kit.payment_proof.txid).toBe(HERO_TXID);
  await expect(paper.getByRole("link", { name: "Check the payment proof" })).toHaveAttribute(
    "href",
    `/verify#${kit.payment_proof.token}`,
  );
});

/** Animations on the two-view panel (the thread and the bars), finished or not. */
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
  await expect(page.getByRole("group", { name: "What Amara's viewing key shows" })).toContainText("$4,800.00");

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.reload();
  expect((await panelAnimations(page)).length).toBeGreaterThan(0);
  await expect.poll(async () => (await panelAnimations(page)).every((s) => s === "finished")).toBe(true);
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
  // Hero (2), the allocation step (1), and the three runs' allocations (3) and payments (18).
  expect(txLinks.length).toBeGreaterThanOrEqual(24);
  for (const l of txLinks) {
    const m = EXPLORER_TX.exec(l.href);
    expect(m, `${l.href} is not a testnet explorer link`).not.toBeNull();
    expect(l.txid).toBe(m![1]);
    expect(l.target).toBe("_blank");
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
  const demo = await demoLink();
  await expect(panel.getByRole("link", { name: demo.name })).toHaveAttribute("href", demo.href);

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
