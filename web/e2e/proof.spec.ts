/*
  Payment proofs end to end: a contractor creates a proof for one payment from their statement,
  a third party opens the link with no key and sees that payment verified against the chain,
  checks the address it was paid to, and an altered link is refused.

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

  // 1. The contractor's statement offers a proof for each mined payment.
  await page.goto("/app/contractor", { waitUntil: "networkidle" });
  await page.locator("#ufvk").fill(key.ufvk);
  await page.getByRole("button", { name: "Show statement" }).click();
  await expect(page.locator("#statement-title")).toContainText(key.label, { timeout: 180_000 });
  await page
    .getByRole("button", { name: /^Prove the payment/ })
    .first()
    .click();
  const linkField = page.getByLabel("Proof link", { exact: true });
  await expect(linkField).toHaveValue(/\/verify#pp1[A-Za-z0-9_-]{92}$/, { timeout: 60_000 });
  const link = await linkField.inputValue();

  // 2. Someone with only the link sees that payment, checked against the chain.
  const verifier = await context.newPage();
  await verifier.goto(link, { waitUntil: "networkidle" });
  await expect(verifier.getByText("Payment verified on chain")).toBeVisible({ timeout: 60_000 });
  await expect(verifier.getByRole("heading", { level: 1 })).toHaveText(/^Payslip for /);
  await expect(verifier.getByText("Transaction id")).toBeVisible();

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

  // 4. One changed character in the proof and it no longer opens anything.
  const token = link.split("#")[1];
  const last = token.at(-2) === "A" ? "B" : "A";
  const tampered = `${link.split("#")[0]}#${token.slice(0, -2)}${last}${token.at(-1)}`;
  const forger = await context.newPage();
  await forger.goto(tampered, { waitUntil: "networkidle" });
  await expect(forger.getByRole("alert").filter({ hasText: /proof/ })).toContainText(
    /does not match the transaction|not a valid Payslip payment proof/,
    {
      timeout: 60_000,
    },
  );
  await expect(forger.getByText("Payment verified on chain")).toHaveCount(0);
});

test("the verify page asks for a proof when the link carries none", async ({ page }) => {
  await page.goto("/verify", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Verify a payment");
  await expect(page.getByRole("button", { name: "Verify payment" })).toBeDisabled();
  await page.getByLabel("Proof link or code").fill("pp1notaproof");
  await page.getByRole("button", { name: "Verify payment" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /proof/ })).toContainText("not a valid Payslip payment proof");
});
