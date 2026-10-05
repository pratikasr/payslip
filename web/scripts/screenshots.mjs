// Captures every route at 375, 768 and 1440 px wide into docs/screenshots/.
//
// Usage (from web/):
//   pnpm exec playwright install chromium   # once
//   pnpm build && pnpm start                # or pnpm dev, in another terminal
//   pnpm screenshots                        # BASE_URL defaults to http://localhost:3000
//
// Optional: RUN_ID=<uuid> adds the run detail page; THEME=dark captures dark mode.
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const THEME = process.env.THEME === "dark" ? "dark" : "light";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "screenshots");

const routes = [
  ["landing", "/"],
  ["app", "/app"],
  ["payer", "/app/payer"],
  ["payer-contractors", "/app/payer/contractors"],
  ["payer-runs", "/app/payer/runs"],
  ["payer-runs-new", "/app/payer/runs/new"],
  ["contractor", "/app/contractor"],
  ["accountant", "/app/accountant"],
];
if (process.env.RUN_ID) routes.push(["payer-run-detail", `/app/payer/runs/${process.env.RUN_ID}`]);

const widths = [375, 768, 1440];

mkdirSync(OUT, { recursive: true });
// Resolve localhost to IPv4 so another local server bound to [::1] cannot answer
// instead of Next. The page origin stays http://localhost:3000, which is the
// origin the service allows through CORS by default.
const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP localhost 127.0.0.1"] });
try {
  for (const width of widths) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      colorScheme: THEME,
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    for (const [name, path] of routes) {
      await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
      // Let skeletons resolve into data or error states.
      await page.waitForTimeout(1200);
      const file = join(OUT, `${name}-${width}${THEME === "dark" ? "-dark" : ""}.png`);
      await page.screenshot({ path: file, fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      console.log(`${overflow ? "OVERFLOW " : ""}${file}`);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
