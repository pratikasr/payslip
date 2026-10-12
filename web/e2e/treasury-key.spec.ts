/*
  The treasury key, from the browser (docs/API.md, Treasury key): against a service started with
  no seed file and sign-in required, the first admin creates the key on the onboarding sheet (24
  words shown once, three asked back, a passphrase typed twice, the phrase encrypted here and
  only the ciphertext sent), then locks it, sees the TREASURY LOCKED stamp, and unlocks it. A
  viewer reads the key page and gets no actions.

  scripts/e2e-treasury-key.sh starts both on their own ports and runs this file. It skips itself
  on a service whose health does not report `treasury` (one from before the key was managed
  from the console). By hand: E2E_TREASURY=1 E2E_BASE_URL=http://127.0.0.1:3322
  E2E_API_URL=http://127.0.0.1:8097 pnpm exec playwright test e2e/treasury-key.spec.ts
*/
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const BASE = (process.env.E2E_BASE_URL ?? "http://127.0.0.1:3322").replace(/\/+$/, "");
const API = (process.env.E2E_API_URL ?? "http://127.0.0.1:8097").replace(/\/+$/, "");
const ADMIN = {
  name: "Owner Example",
  email: process.env.E2E_AUTH_ADMIN_EMAIL ?? "owner@example.test",
  password: "payslip-e2e-owner-password",
};
const VIEWER = { name: "Vera Viewer", email: "viewer@example.test", password: "payslip-e2e-viewer-password" };
const PASSPHRASE = "orchard ledger carbon paper 2026";

test.skip(process.env.E2E_TREASURY !== "1", "Needs the no-seed setup: scripts/e2e-treasury-key.sh");
test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ request }) => {
  const health = await (await request.get(`${API}/api/health`)).json();
  test.skip(!("treasury" in health), "This service does not report a treasury key in health; nothing to create here");
});

async function signUp(request: APIRequestContext, user: typeof ADMIN) {
  const r = await request.post(`${BASE}/api/auth/sign-up/email`, { data: user, headers: { Origin: BASE } });
  expect([200, 422], `sign-up ${user.email} answered ${r.status()}: ${await r.text()}`).toContain(r.status());
}

async function signIn(page: Page, user: typeof ADMIN, next = "/console") {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in with email" }).click();
}

async function signOut(page: Page) {
  await page.getByTestId("signed-in-as").getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
}

let address = "";
let inviteLink = "";

test("the first admin creates the treasury key in the browser; only the ciphertext reaches the service", async ({
  page,
  request,
}) => {
  await signUp(request, ADMIN);
  await signUp(request, VIEWER);
  const before = await (await request.get(`${API}/api/health`)).json();
  expect(before.treasury).toBe("no_key");

  await signIn(page, ADMIN);
  await expect(page).toHaveURL(/\/console$/);
  const sheet = page.getByTestId("treasury-onboarding");
  await expect(sheet.getByRole("heading", { level: 1, name: "Create your treasury key" })).toBeVisible();
  // Nothing of the console shows until the key exists.
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);

  // Step 1: create new words.
  await expect(sheet.getByRole("radio", { name: "Create a new key" })).toBeChecked();
  await sheet.getByRole("button", { name: "Continue" }).click();

  // Step 2: the 24 words, typed on the form, then three of them asked back.
  const words = sheet.getByTestId("recovery-words").locator("[data-word]");
  await expect(words).toHaveCount(24);
  const phrase = (await words.allTextContents()).map((w) => w.trim());
  expect(new Set(phrase).size).toBeGreaterThan(20);
  for (const w of phrase) expect(w).toMatch(/^[a-z]+$/);
  // No copy button for the words, on purpose.
  await expect(sheet.getByRole("button", { name: /copy/i })).toHaveCount(0);
  const cont = sheet.getByRole("button", { name: "Continue" });
  await expect(cont).toBeDisabled();
  await sheet.getByRole("checkbox", { name: "I have written them down" }).check();
  await cont.click();
  await expect(sheet.getByRole("heading", { level: 2, name: "Check your copy" })).toBeVisible();
  const asked = sheet.getByRole("textbox", { name: /^Word \d+$/ });
  await expect(asked).toHaveCount(3);
  // A wrong word is caught before the passphrase.
  const first = asked.nth(0);
  const n0 = Number(((await first.getAttribute("id")) ?? "").split("-").pop());
  await first.fill("payslip");
  await sheet.getByRole("button", { name: "Continue" }).click();
  await expect(sheet.getByRole("alert")).toContainText(`Word ${n0} does not match`);
  for (let i = 0; i < 3; i++) {
    const n = Number(((await asked.nth(i).getAttribute("id")) ?? "").split("-").pop());
    await asked.nth(i).fill(phrase[n - 1]);
  }
  await sheet.getByRole("button", { name: "Continue" }).click();

  // Step 3: the passphrase, twice, and the sentence that goes with it.
  await expect(sheet.getByRole("heading", { level: 2, name: "Passphrase" })).toBeVisible();
  await expect(
    sheet.getByText("This passphrase encrypts your key. Payslip never stores it.", { exact: false }),
  ).toBeVisible();
  await sheet.getByLabel("Passphrase", { exact: true }).fill("short");
  await sheet.getByLabel("Passphrase again").fill("short");
  await sheet.getByRole("button", { name: "Encrypt and save" }).click();
  await expect(sheet.getByText("Use at least 12 characters.")).toBeVisible();
  await sheet.getByLabel("Passphrase", { exact: true }).fill(PASSPHRASE);
  await sheet.getByLabel("Passphrase again").fill(PASSPHRASE + "x");
  await sheet.getByRole("button", { name: "Encrypt and save" }).click();
  await expect(sheet.getByText("The two copies differ.", { exact: false })).toBeVisible();
  await sheet.getByLabel("Passphrase again").fill(PASSPHRASE);

  // What goes to the service: an age-armored ciphertext and the passphrase, never the words.
  const upload = page.waitForRequest((r) => r.url().endsWith("/api/treasury/key") && r.method() === "POST");
  await sheet.getByRole("button", { name: "Encrypt and save" }).click();
  const body = (await upload).postDataJSON() as { ciphertext: string; passphrase?: string };
  expect(body.ciphertext.startsWith("-----BEGIN AGE ENCRYPTED FILE-----\n")).toBe(true);
  expect(body.ciphertext.trimEnd().endsWith("-----END AGE ENCRYPTED FILE-----")).toBe(true);
  for (const w of phrase) expect(body.ciphertext).not.toContain(` ${w} `);
  expect(JSON.stringify(body)).not.toContain(phrase.join(" "));
  const header = Buffer.from(body.ciphertext.split("\n").slice(1, -2).join(""), "base64").toString("latin1");
  expect(header.startsWith("age-encryption.org/v1\n-> scrypt ")).toBe(true);
  expect(header.split("\n")[1]).toMatch(/^-> scrypt [A-Za-z0-9+/]+ 18$/);

  // Success: the treasury address, then the console.
  await expect(sheet.getByRole("heading", { level: 2, name: "Treasury key" })).toBeVisible();
  address = ((await sheet.getByTestId("treasury-address").textContent()) ?? "").trim();
  expect(address).toMatch(/^(u|utest)1[a-z0-9]{20,}$/);
  const key = await (await page.request.get(`${BASE}/api/svc/api/treasury/key`)).json();
  expect(key.address).toBe(address);
  expect(["unlocked", "locked"]).toContain(key.state);
  await sheet.getByRole("button", { name: "Open the console" }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  const after = await (await request.get(`${API}/api/health`)).json();
  expect(after.treasury).not.toBe("no_key");
  const refused = await page.request.post(`${BASE}/api/svc/api/treasury/key`, {
    data: { ciphertext: body.ciphertext, passphrase: PASSPHRASE },
  });
  expect(refused.status()).toBe(409);
  expect((await refused.json()).error.code).toBe("key_exists");
  await signOut(page);
});

test("the admin locks the key, every page carries the stamp, and unlocks it with the passphrase", async ({ page }) => {
  await signIn(page, ADMIN, "/console/settings/treasury-key");
  await expect(page.getByRole("heading", { level: 1, name: "Treasury key" })).toBeVisible();
  const status = page.getByTestId("treasury-key-state");
  await expect(page.getByTestId("treasury-key-address")).toHaveAttribute("title", address);
  await expect(page.getByTestId("who-can-spend")).toContainText(
    "While locked, nobody can spend your treasury, including the operator of this server.",
  );
  await expect(page.getByTestId("who-can-spend")).toContainText("For full control, self-host Payslip");
  // The key may still be unlocked from its creation; lock it, if so.
  const word = page.getByTestId("treasury-key-state-word");
  if ((await word.textContent())?.trim() === "Unlocked") {
    await status.getByRole("button", { name: "Lock now" }).click();
  }
  await expect(word).toHaveText("Locked");
  await expect(page.getByTestId("treasury-locked-stamp")).toBeVisible();
  await expect(page.getByTestId("treasury-locked-stamp")).toContainText(/treasury locked/i);
  // The stamp is on every console page while the key is locked.
  await page.goto("/console/people");
  await expect(page.getByTestId("treasury-locked-stamp")).toBeVisible();
  // The service refuses to spend while locked.
  const key = await (await page.request.get(`${BASE}/api/svc/api/treasury/key`)).json();
  expect(key.state).toBe("locked");
  expect(key.unlocked_until).toBeNull();

  // Unlock: a wrong passphrase is refused, the right one unlocks for the hours chosen.
  await page.goto("/console/settings/treasury-key");
  await status.getByRole("button", { name: "Unlock" }).click();
  const dialog = page.getByRole("dialog", { name: "Unlock the treasury" });
  await dialog.getByLabel("Passphrase").fill("not the passphrase");
  await dialog.getByRole("button", { name: "Unlock" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByLabel("Passphrase").fill(PASSPHRASE);
  await dialog.getByLabel("For").selectOption("1");
  await dialog.getByRole("button", { name: "Unlock" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(word).toHaveText("Unlocked");
  await expect(status).toContainText("Unlocked until");
  await expect(page.getByTestId("treasury-locked-stamp")).toHaveCount(0);
  const unlocked = await (await page.request.get(`${BASE}/api/svc/api/treasury/key`)).json();
  expect(unlocked.state).toBe("unlocked");
  const until = Date.parse(unlocked.unlocked_until);
  expect(until - Date.now()).toBeGreaterThan(50 * 60 * 1000);
  expect(until - Date.now()).toBeLessThan(70 * 60 * 1000);

  // Settings and Treasury point here.
  await page.goto("/console/settings");
  await expect(page.getByRole("link", { name: "Treasury key" })).toBeVisible();
  await page.goto("/console/treasury");
  await expect(page.getByRole("link", { name: "How it is protected" })).toBeVisible();

  // A viewer, invited through the proxy, reads the page and gets no actions.
  const invited = await page.request.post(`${BASE}/api/svc/api/org/invitations`, {
    data: { email: VIEWER.email, role: "viewer" },
  });
  expect(invited.status(), await invited.text()).toBe(201);
  inviteLink = `${BASE}/invite/${(await invited.json()).token as string}`;
  await signOut(page);
});

test("a viewer reads the treasury key page but cannot act on it", async ({ page }) => {
  expect(inviteLink).not.toBe("");
  await signIn(page, VIEWER);
  await page.goto(inviteLink);
  await page.getByRole("button", { name: "Open the console" }).click();
  await page.goto("/console/settings/treasury-key");
  await expect(page.getByRole("heading", { level: 1, name: "Treasury key" })).toBeVisible();
  const status = page.getByTestId("treasury-key-state");
  await expect(status).toContainText("Admins unlock, lock, replace and move the key; your role reads this page.");
  await expect(status.getByRole("button", { name: "Lock now" })).toHaveCount(0);
  await expect(status.getByRole("button", { name: "Replace key" })).toHaveCount(0);
  await expect(status.getByRole("button", { name: "Move treasury" })).toHaveCount(0);
  // The service, not the page, holds the line.
  const refused = await page.request.post(`${BASE}/api/svc/api/treasury/lock`, { data: {} });
  expect(refused.status()).toBe(403);
  await signOut(page);
});
