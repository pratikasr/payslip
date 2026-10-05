// Captures the data-bearing states of the app (statement, reconciliation, dialogs, dark mode)
// at 375, 768 and 1440 px into docs/screenshots/, using real data from a running service.
//
// Usage (from web/), with the service and the web app running:
//   BASE_URL=http://127.0.0.1:3100 API_URL=http://127.0.0.1:8080 node scripts/screenshots-states.mjs
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

      if (theme === "dark") {
        for (const [name, path] of [
          ["landing", "/"],
          ["payer", "/app/payer"],
        ]) {
          await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
          await page.waitForTimeout(1000);
          await shot(page, name, width, theme);
        }
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
}
