// Captures the data-bearing states of the app (statement, reconciliation, dialogs, insights as
// tables, dark mode, presenter mode at 1280x720) at 375, 768 and 1440 px into docs/screenshots/,
// using real data from a running service.
//
// Usage (from web/), with the service and the web app running:
//   BASE_URL=http://127.0.0.1:3100 API_URL=http://127.0.0.1:8080 node scripts/screenshots-states.mjs
// Optional: EMPTY_API_URL=<a second service on an empty testnet wallet> adds the first-run payer pages.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const API_URL = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "screenshots");
const widths = (process.env.WIDTHS ?? "375,768,1440").split(",").map(Number);
mkdirSync(OUT, { recursive: true });

const keys = (await (await fetch(`${API_URL}/api/viewing-keys`)).json()).keys;
const contractor = keys.find((k) => k.role === "contractor");

async function shot(page, name, width, theme) {
  const file = join(OUT, `${name}-${width}${theme === "dark" ? "-dark" : ""}.png`);
  await page.screenshot({ path: file, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  console.log(`${overflow ? "OVERFLOW " : ""}${file}`);
}

/** Scroll through the page so anything that starts when it comes into view (the landing's unseal) has played. */
async function settle(page) {
  await page.evaluate(async () => {
    const step = Math.max(200, Math.floor(window.innerHeight * 0.6));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(2200);
}

const runs = (await (await fetch(`${API_URL}/api/runs`)).json()).runs;
const paidRun = runs.find((r) => r.status === "paid");

const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP localhost 127.0.0.1"] });
try {
  for (const theme of ["light", "dark"]) {
    for (const width of widths) {
      if (theme === "dark" && width === 768) continue;
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        colorScheme: theme,
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();

      // Contractor statement from one viewing key.
      await page.goto(`${BASE_URL}/app/contractor`, { waitUntil: "networkidle" });
      await page.getByLabel("Viewing key").fill(contractor.ufvk);
      await page.getByRole("button", { name: "Show statement" }).click();
      await page.locator("#statement-title").waitFor({ timeout: 120_000 });
      await page.waitForTimeout(800);
      await shot(page, "contractor-statement", width, theme);

      // Accountant reconciliation from every exported key.
      await page.goto(`${BASE_URL}/app/accountant`, { waitUntil: "networkidle" });
      await page.getByLabel("Viewing keys, one per line").fill(keys.map((k) => k.ufvk).join("\n"));
      await page.getByRole("button", { name: /^Reconcile/ }).click();
      await page.locator("#recon-title").waitFor({ timeout: 180_000 });
      await page.waitForTimeout(800);
      await shot(page, "accountant-reconciliation", width, theme);

      // Share a viewing key (dialog with QR).
      await page.goto(`${BASE_URL}/app/payer/contractors`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Share viewing key" }).first().click();
      await page.getByRole("dialog").waitFor();
      await page.waitForTimeout(800);
      await shot(page, "share-viewing-key", width, theme);

      // Payroll insights as tables (the accessible twin of the charts).
      if (theme === "light") {
        await page.goto(`${BASE_URL}/app/payer`, { waitUntil: "networkidle" });
        await page.getByRole("button", { name: "Tables" }).click();
        await page.locator("#insights").scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await page.locator("#insights").screenshot({
          path: join(OUT, `payer-insights-tables-${width}.png`),
        });
        console.log(join(OUT, `payer-insights-tables-${width}.png`));
      }

      if (theme === "dark") {
        const pages = [
          ["landing", "/"],
          ["payer", "/app/payer"],
        ];
        if (paidRun) pages.push(["payer-run-detail", `/app/payer/runs/${paidRun.id}`]);
        for (const [name, path] of pages) {
          await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
          await settle(page);
          await shot(page, name, width, theme);
        }
      }
      await context.close();
    }
  }

  // Presenter mode (?present=1) in the frame a 1280x720 recording sees: viewport only, not the full page.
  const present = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const p = await present.newPage();
  const frames = [
    ["present-landing", "/?present=1"],
    ["present-payer", "/app/payer"],
  ];
  if (paidRun) frames.push(["present-run", `/app/payer/runs/${paidRun.id}`]);
  for (const [name, path] of frames) {
    await p.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
    await settle(p);
    const file = join(OUT, `${name}-1280x720.png`);
    await p.screenshot({ path: file });
    console.log(file);
  }
  await present.close();

  // First run: with EMPTY_API_URL pointing at a second service on an empty testnet wallet, the
  // payer overview and runs pages are captured with the browser's API calls sent there instead.
  const EMPTY_API_URL = process.env.EMPTY_API_URL?.replace(/\/+$/, "");
  if (EMPTY_API_URL) {
    for (const [theme, width] of [
      ["light", 375],
      ["light", 1440],
      ["dark", 1440],
    ]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme });
      await context.route(`${API_URL}/**`, async (route) => {
        const url = route.request().url().replace(API_URL, EMPTY_API_URL);
        await route.fulfill({ response: await route.fetch({ url }) });
      });
      const page = await context.newPage();
      for (const [name, path] of [
        ["payer-first-run", "/app/payer"],
        ["payer-runs-first-run", "/app/payer/runs"],
      ]) {
        if (theme === "dark" && name !== "payer-first-run") continue;
        await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
        await settle(page);
        await shot(page, name, width, theme);
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}
