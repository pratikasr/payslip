// Captures the run page while a run executes, for design review of the live progress
// (segment bar, row transitions, confirmations arriving) without spending testnet coins.
//
// How: the browser's requests for one paid run are answered with that same run's real lines
// rewound through the statuses it passed on the way to paid (allocated, broadcast, confirmed),
// one Server-Sent Events snapshot per step. Txids, heights and explorer links are the run's own;
// only the order in time is replayed. Nothing is sent to the chain, and the files are named
// "-replay" so they are never mistaken for a live run.
//
// Usage (from web/), with the service and the web app running:
//   BASE_URL=http://127.0.0.1:3100 API_URL=http://127.0.0.1:8080 node scripts/screenshots-live.mjs
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const BASE_URL = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const API_URL = (process.env.API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "screenshots");
mkdirSync(OUT, { recursive: true });

const runs = (await (await fetch(`${API_URL}/api/runs`)).json()).runs;
const real = runs.find((r) => r.status === "paid" && r.lines.length >= 3);
if (!real) {
  console.error("No paid run with three or more lines on this service; nothing to replay.");
  process.exit(1);
}

/** The run as it was at step `k` of its execution. */
function stage(k) {
  const n = real.lines.length;
  const half = Math.ceil(n / 2);
  const lines = real.lines.map((l, i) => {
    let status = "allocated";
    if (k >= 1 && i < 2) status = "broadcast";
    if (k >= 2 && i < Math.min(n, 4)) status = "broadcast";
    if (k >= 3) status = "broadcast";
    if (k >= 4 && i < half) status = "confirmed";
    if (k >= 5) status = "confirmed";
    return {
      ...l,
      status,
      txid: status === "allocated" ? null : l.txid,
      explorer_url: status === "allocated" ? null : l.explorer_url,
      confirmed_height: status === "confirmed" ? l.confirmed_height : null,
    };
  });
  return {
    ...real,
    status: k >= 5 ? "paid" : "paying",
    executing: k < 5,
    lines,
    updated_at: new Date(Date.now() + 60_000 + k * 1000).toISOString(),
  };
}

const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP localhost 127.0.0.1"] });
try {
  for (const [width, height] of [
    [1440, 900],
    [375, 900],
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    let k = 0;
    await page.route(`${API_URL}/api/runs/${real.id}`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(stage(k)) }),
    );
    await page.route(`${API_URL}/api/runs/${real.id}/log`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ events: [] }) }),
    );
    // Each SSE connection gets the current step and closes; the browser reconnects after `retry`.
    await page.route(`${API_URL}/api/runs/${real.id}/events`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: `retry: 300\nevent: snapshot\ndata: ${JSON.stringify(stage(k))}\n\n`,
      }),
    );
    await page.goto(`${BASE_URL}/app/payer/runs/${real.id}`, { waitUntil: "domcontentloaded" });
    await page.getByText("payments confirmed").first().waitFor();
    for (k = 1; k <= 4; k++) await page.waitForTimeout(900);
    // Mid-flight: half confirmed, the rest broadcast, the latest rows still marking their change.
    k = 4;
    await page.waitForTimeout(700);
    const file = join(OUT, `payer-run-live-replay-${width}.png`);
    await page.screenshot({ path: file, fullPage: width < 768 ? false : true });
    console.log(file);
    await context.close();
  }
} finally {
  await browser.close();
}
