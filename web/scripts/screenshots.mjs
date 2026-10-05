// Captures every screen at 375, 768 and 1440 px wide into docs/screenshots/, from live data.
//
// Usage (from web/):
//   pnpm exec playwright install chromium   # once
//   pnpm build && pnpm start                # or pnpm dev, in another terminal
//   pnpm screenshots                        # BASE_URL defaults to http://localhost:3000
//   THEME=dark pnpm screenshots             # dark mode
//
// The contractor portal is opened with the first contractor's invite link and the accountant's
// books with "Load this company's keys", both from the running service (API_URL, default
// http://127.0.0.1:8080). The run page uses the newest run; the public payslip uses the payment
// proof in docs/judge/judge-kit-testnet.json unless PROOF_TOKEN is set.
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const API_URL = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const THEME = process.env.THEME === "dark" ? "dark" : "light";
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "..", "docs", "screenshots");
const widths = (process.env.WIDTHS ?? "375,768,1440").split(",").map(Number);

async function get(path) {
  const r = await fetch(`${API_URL}${path}`);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

const runs = (await get("/api/runs")).runs.sort((a, b) => b.created_at.localeCompare(a.created_at));
const keys = (await get("/api/viewing-keys")).keys;
const contractorKey = keys.find((k) => k.role === "contractor");
let token = process.env.PROOF_TOKEN;
if (!token) {
  try {
    token = JSON.parse(readFileSync(join(HERE, "..", "..", "docs", "judge", "judge-kit-testnet.json"), "utf8"))
      .payment_proof?.token;
  } catch {
    token = undefined;
  }
}

/** Scroll through the page so lazy content and in-view animations have settled. */
async function settle(page) {
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight * 0.6));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 100));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(1200);
}

async function shoot(page, name, width) {
  await settle(page);
  const file = join(OUT, `${name}-${width}${THEME === "dark" ? "-dark" : ""}.png`);
  await page.screenshot({ path: file, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log(`${overflow ? "OVERFLOW " : ""}${file}`);
}

async function visit(page, name, path, width) {
  // Some pages hold a live connection open (run progress), so wait for load and let data settle.
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "load" });
  await page.waitForTimeout(2500);
  await shoot(page, name, width);
}

async function booksShots(page, width) {
  await page.goto(`${BASE_URL}/books`, { waitUntil: "load" });
  const load = page.getByRole("button", { name: "Load this company's keys" });
  await load.waitFor({ timeout: 60_000 }).catch(() => undefined);
  if (await load.count()) {
    await load.click();
    await page.getByTestId("books-runs").waitFor({ state: "attached", timeout: 300_000 });
    await shoot(page, "books-reconciliation", width);
    await visit(page, "books-ledger", "/books/ledger", width);
    await visit(page, "books-exceptions", "/books/exceptions", width);
    await visit(page, "books-exports", "/books/exports", width);
  }
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP localhost 127.0.0.1"] });
try {
  for (const width of widths) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: THEME });
    const page = await context.newPage();

    const only = process.env.ONLY;
    if (only === "books") {
      await booksShots(page, width);
      await context.close();
      continue;
    }
    await visit(page, "landing", "/", width);
    await visit(page, "console-home", "/console", width);
    await visit(page, "console-runs", "/console/runs", width);
    if (runs[0]) await visit(page, "console-run", `/console/runs/${runs[0].id}`, width);
    await visit(page, "console-run-new", "/console/runs/new", width);
    await visit(page, "console-people", "/console/people", width);
    await visit(page, "console-access", "/console/access", width);
    await visit(page, "console-treasury", "/console/treasury", width);

    if (contractorKey) {
      await page.goto(`${BASE_URL}/portal#key=${encodeURIComponent(contractorKey.ufvk)}`);
      await page.getByRole("heading", { level: 1, name: /^Welcome, / }).waitFor({ timeout: 180_000 });
      await shoot(page, "portal-home", width);
      await visit(page, "portal-payslips", "/portal/payslips", width);
      const slip = page.getByRole("link", { name: /^Payslip for / }).first();
      await slip.waitFor({ timeout: 120_000 }).catch(() => undefined);
      if (await slip.count()) {
        await slip.click();
        await page.getByRole("button", { name: "Share proof" }).waitFor({ timeout: 120_000 });
        await shoot(page, "portal-payslip", width);
      }
      await visit(page, "portal-tax", "/portal/tax", width);
    }

    await booksShots(page, width);

    if (token) {
      await page.goto(`${BASE_URL}/verify#${token}`, { waitUntil: "load" });
      await page
        .getByText(/Verified on Zcash/)
        .first()
        .waitFor({ timeout: 120_000 });
      await shoot(page, "verify", width);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
