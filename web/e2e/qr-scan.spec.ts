/*
  Viewing key by camera, end to end: the QR code the payer's Share viewing key dialog renders is
  captured, turned into a video file, and played to the Contractor page as its camera (Chromium's
  fake capture device). The page must decode the key from the camera and load that contractor's
  statement from the live testnet service.

  Needs the testnet service and the web app running (E2E_API_URL, E2E_BASE_URL) with at least
  one contractor. Run: pnpm exec playwright test e2e/qr-scan.spec.ts
*/
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { chromium, expect, test } from "@playwright/test";

const BASE = (process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100").replace(/\/+$/, "");

// Writes a Y4M video (4:2:0) of the QR image centred on a white 1280x720 frame.
const TO_Y4M = `
import sys
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
qr = Image.open(src).convert("RGB")
side = 640
qr = qr.resize((side, side), Image.NEAREST)
frame = Image.new("RGB", (1280, 720), "white")
frame.paste(qr, ((1280 - side) // 2, (720 - side) // 2))
y, cb, cr = frame.convert("YCbCr").split()
cb = cb.resize((640, 360))
cr = cr.resize((640, 360))
with open(dst, "wb") as f:
    f.write(b"YUV4MPEG2 W1280 H720 F10:1 Ip A1:1 C420jpeg\\n")
    for _ in range(20):
        f.write(b"FRAME\\n")
        f.write(y.tobytes()); f.write(cb.tobytes()); f.write(cr.tobytes())
`;

test("a viewing key shown as a QR code is scanned by camera into a statement", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  const dir = test.info().outputDir;

  // 1. The payer shares a key: read the text and capture the QR the dialog renders.
  await page.goto(`${BASE}/app/payer/contractors`);
  await page.getByRole("button", { name: "Share viewing key" }).first().click();
  const dialog = page.getByRole("dialog");
  const key = await dialog.getByLabel("Unified full viewing key").inputValue();
  expect(key).toMatch(/^uvf(test)?1/);
  const title = await dialog.getByRole("heading").first().innerText();
  const qr = dialog.getByRole("img", { name: /QR code of the viewing key/ });
  await expect(qr).toBeVisible();
  const png = join(dir, "key-qr.png");
  await qr.screenshot({ path: png });

  // 2. That image becomes the camera.
  const y4m = join(dir, "camera.y4m");
  execFileSync("python3", ["-c", TO_Y4M, png, y4m]);

  // 3. The contractor scans it.
  const browser = await chromium.launch({
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-video-capture=${y4m}`,
    ],
  });
  try {
    const context = await browser.newContext({ permissions: ["camera"] });
    const contractor = await context.newPage();
    await contractor.goto(`${BASE}/app/contractor`);
    await contractor.getByRole("button", { name: "Scan QR code" }).click();
    await expect(contractor.locator("#ufvk")).toHaveValue(key, { timeout: 60_000 });
    await contractor.getByRole("button", { name: "Show statement" }).click();
    await expect(contractor.locator("#statement-title")).toBeVisible({ timeout: 180_000 });
    const name = title.replace(/^Viewing key for /, "").trim();
    if (name && name !== title) await expect(contractor.locator("#statement-title")).toContainText(name);
  } finally {
    await browser.close();
  }
});
