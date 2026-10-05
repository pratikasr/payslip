/*
  Payslip access by camera, end to end: the QR code of a contractor's invite link (Payslip access,
  company console) is captured, turned into a video file, and played to the contractor portal's
  unlock screen as its camera (Chromium's fake capture device). The portal must decode the invite
  link from the camera and open that contractor's payslips from the live testnet service.

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

test("an invite link shown as a QR code is scanned by camera into the contractor portal", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  const dir = test.info().outputDir;

  // 1. The company shares access: read the link and capture the QR the invite dialog renders.
  await page.goto(`${BASE}/console/access`);
  const invite = page.getByRole("button", { name: /^Invite .*: QR code and link$/ }).first();
  const label = (await invite.getAttribute("aria-label"))!;
  const name = label.replace(/^Invite /, "").replace(/: QR code and link$/, "");
  await invite.click();
  const dialog = page.getByRole("dialog");
  const link = await dialog.getByRole("textbox", { name: "Invite link" }).inputValue();
  expect(link).toMatch(/\/portal#key=uvf(test)?1/);
  const qr = dialog.getByRole("img", { name: /QR code of the invite link/ });
  await expect(qr).toBeVisible();
  const png = join(dir, "invite-qr.png");
  await qr.screenshot({ path: png });

  // 2. That image becomes the camera.
  const y4m = join(dir, "camera.y4m");
  execFileSync("python3", ["-c", TO_Y4M, png, y4m]);

  // 3. The contractor scans it on the portal's unlock screen.
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
    await contractor.goto(`${BASE}/portal`);
    await contractor.getByRole("button", { name: "Scan QR" }).click();
    await expect(contractor.getByRole("heading", { level: 1 })).toHaveText(
      new RegExp(`^Welcome, ${name.split(" ")[0]}$`),
      { timeout: 240_000 },
    );
  } finally {
    await browser.close();
  }
});
