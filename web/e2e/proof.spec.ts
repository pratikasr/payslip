/*
  Payment proofs end to end: a contractor shares a proof from one payslip in the portal, a third
  party opens the link with no key and sees that payment verified against the chain, checks the
  address it was paid to, and an altered link is refused.

  Needs the testnet service and the web app running (E2E_API_URL, E2E_BASE_URL) with at least
  one paid contractor. Spends nothing. Run: pnpm exec playwright test e2e/proof.spec.ts
*/
import { expect, test } from "@playwright/test";

const API = (process.env.E2E_API_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");

test("a contractor proves one payment and anyone can verify it", async ({ page, context }) => {
  test.setTimeout(5 * 60_000);
  const keys = (await (await fetch(`${API}/api/viewing-keys`)).json()).keys as {
    role: string;
    ufvk: string;
    label: string;
    contractor_id: string | null;
  }[];
  const contractors = (await (await fetch(`${API}/api/contractors`)).json()).contractors as {
    id: string;
    unified_address: string;
  }[];
  const key = keys.find((k) => k.role === "contractor")!;
  const address = contractors.find((c) => c.id === key.contractor_id)!.unified_address;
  const other = contractors.find((c) => c.id !== key.contractor_id)?.unified_address;

  // 1. The contractor opens a payslip in the portal and shares a proof of it.
  await page.goto(`/portal#key=${encodeURIComponent(key.ufvk)}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Welcome, /, { timeout: 180_000 });
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Payslips" }).click();
  await page
    .getByRole("link", { name: /^Payslip for / })
    .first()
    .click();
  await expect(page).toHaveURL(/\/portal\/payslips\/[0-9a-f]{64}$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Payslip for /);
  await page.getByRole("button", { name: "Share proof" }).click();
  const linkField = page.getByLabel("Proof link", { exact: true });
  await expect(linkField).toHaveValue(/\/verify#pp1[A-Za-z0-9_-]{92}$/, { timeout: 60_000 });
  const link = await linkField.inputValue();
  await expect(page.getByText("What stays private")).toBeVisible();

  // 2. Someone with only the link sees that payment, checked against the chain, with no app chrome.
  const verifier = await context.newPage();
  await verifier.goto(link, { waitUntil: "networkidle" });
  await expect(verifier.getByText(/^Verified on Zcash/)).toBeVisible({ timeout: 60_000 });
  await expect(verifier.getByRole("heading", { level: 1 })).toHaveText(/^Payslip for /);
  await expect(verifier.getByRole("heading", { name: "What this proof shows" })).toBeVisible();
  await expect(verifier.getByText("Transaction", { exact: true })).toBeVisible();
  await expect(verifier.getByText(/^Viewing as/)).toHaveCount(0);
  await expect(verifier.getByText("This payment was sent with Payslip, private payroll on Zcash.")).toBeVisible();

  // 3. The address check: the contractor's own address matches, another contractor's does not.
  const field = verifier.getByLabel(/Check the address it was paid to/);
  await field.fill(address);
  await verifier.getByRole("button", { name: "Check address" }).click();
  await expect(verifier.getByText("Matches the address you entered")).toBeVisible({ timeout: 60_000 });
  if (other) {
    await field.fill(other);
    await verifier.getByRole("button", { name: "Check address" }).click();
    await expect(verifier.getByText("Not the address you entered")).toBeVisible({ timeout: 60_000 });
  }

  // 4. The page prints as a payslip: the address form and the download button stay off paper.
  await verifier.emulateMedia({ media: "print" });
  await expect(verifier.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(verifier.getByRole("button", { name: "Download payslip" })).toBeHidden();
  await expect(field).toBeHidden();
  await verifier.emulateMedia({ media: "screen" });

  // 5. One changed character in the proof and it no longer opens anything.
  const token = link.split("#")[1];
  const last = token.at(-2) === "A" ? "B" : "A";
  const tampered = `${link.split("#")[0]}#${token.slice(0, -2)}${last}${token.at(-1)}`;
  const forger = await context.newPage();
  await forger.goto(tampered, { waitUntil: "networkidle" });
  await expect(forger.getByRole("alert").filter({ hasText: /proof/ })).toContainText(
    /does not match the payment on the Zcash chain|not a complete payslip proof/,
    { timeout: 60_000 },
  );
  await expect(forger.getByText(/^Verified on Zcash/)).toHaveCount(0);
});

test("the verify page asks for a proof when the link carries none", async ({ page }) => {
  await page.goto("/verify", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Check a payslip");
  await expect(page.getByRole("button", { name: "Check payslip" })).toBeDisabled();
  await page.getByLabel("Proof link or code").fill("pp1notaproof");
  await page.getByRole("button", { name: "Check payslip" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /proof/ })).toContainText("not a complete payslip proof");
});
