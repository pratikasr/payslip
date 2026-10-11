/*
  Sign-in, roles and invitations (ADR-026) in the browser, against a service started with
  PAYSLIP_AUTH=required and a web app with the test login on (PAYSLIP_AUTH_TEST_LOGIN=1). The
  first admin is the service's PAYSLIP_BOOTSTRAP_ADMIN_EMAIL; a viewer is invited through the
  console and joins through the link. Run progress is read through the proxy, so the test also
  shows that Server-Sent Events are not buffered on the way. The last test covers recorded
  approvals with PAYSLIP_APPROVALS_REQUIRED=2: the admin's run needs two other approvers.

  scripts/e2e-signin.sh starts both on their own ports with a throwaway testnet wallet and runs
  this file. By hand: E2E_AUTH=1 E2E_BASE_URL=http://127.0.0.1:3304 E2E_CONTRACTOR_ADDRESS=<utest1...>
  pnpm exec playwright test e2e/auth.spec.ts
*/
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const BASE = (process.env.E2E_BASE_URL ?? "http://127.0.0.1:3304").replace(/\/+$/, "");
const ADMIN = {
  name: "Owner Example",
  email: process.env.E2E_AUTH_ADMIN_EMAIL ?? "owner@example.test",
  password: "payslip-e2e-owner-password",
};
const VIEWER = { name: "Vera Viewer", email: "viewer@example.test", password: "payslip-e2e-viewer-password" };
const ANN = { name: "Ann Approver", email: "ann@example.test", password: "payslip-e2e-ann-password" };
const BEN = { name: "Ben Approver", email: "ben@example.test", password: "payslip-e2e-ben-password" };

test.skip(process.env.E2E_AUTH !== "1", "Needs the sign-in setup: scripts/e2e-signin.sh");
test.describe.configure({ mode: "serial" });

/**
 * Creates the test user through Better Auth's own API (it wants the app's Origin on a write);
 * a rerun finds the user already there.
 */
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

let inviteLink = "";

test("the console needs a sign-in; the bootstrap email is the first admin", async ({ page, request }) => {
  await signUp(request, ADMIN);
  await signUp(request, VIEWER);
  await page.goto("/console");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fconsole/);
  await expect(page.getByRole("heading", { name: "Sign in to Payslip", level: 1 })).toBeVisible();
  await signIn(page, ADMIN);
  await expect(page).toHaveURL(/\/console$/);
  const who = page.getByTestId("signed-in-as");
  await expect(who).toContainText(ADMIN.name);
  await expect(who).toContainText("Admin");
  // The organisation is named after the admin's email domain until it is renamed (the next test).
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await expect(page.getByText(/^(example\.test|Example Robotics)$/).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Invitations" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Audit log" })).toBeVisible();
  // No demo bar with sign-in on.
  await expect(page.getByRole("complementary", { name: "Payslip demo" })).toHaveCount(0);
  // An admin reaches Run payroll.
  await page.goto("/console/runs/new");
  await expect(page.getByRole("heading", { name: "Your role cannot run payroll" })).toHaveCount(0);
  await expect(page.getByText("Run payroll").first()).toBeVisible();
});

test("an admin renames the organisation and invites a viewer", async ({ page }) => {
  await signIn(page, ADMIN, "/console/settings");
  await page.getByLabel("Name").fill("Example Robotics");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Organisation saved")).toBeVisible();
  await page.goto("/console/invitations");
  await page.getByLabel("Email").fill(VIEWER.email);
  await page.getByLabel("Role").selectOption("viewer");
  await page.getByRole("button", { name: "Make an invite link" }).click();
  const card = page.getByTestId("invite-link-card");
  await expect(card).toBeVisible();
  inviteLink = (await page.getByTestId("invite-link").textContent())?.trim() ?? "";
  expect(inviteLink).toMatch(new RegExp(`^${BASE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/invite/[A-Za-z0-9_-]{40,}$`));
  const row = page.getByTestId("invitation-row").filter({ hasText: VIEWER.email });
  await expect(row).toContainText("Open");
  // The members page lists the admin alone, with the new organisation name in the sidebar.
  await page.goto("/console/members");
  await expect(page.getByText("Example Robotics").first()).toBeVisible();
  await expect(page.getByTestId("member-row")).toHaveCount(1);
  await signOut(page);
});

test("a viewer joins through the link, sees the console, and cannot run payroll", async ({ page }) => {
  expect(inviteLink).not.toBe("");
  await signIn(page, VIEWER);
  await expect(page.getByRole("heading", { name: "You are not a member yet" })).toBeVisible();
  await page.goto(inviteLink);
  await expect(page.getByRole("heading", { name: "Welcome to Example Robotics" })).toBeVisible();
  await expect(page.getByText("You joined as viewer")).toBeVisible();
  await page.getByRole("button", { name: "Open the console" }).click();
  await expect(page).toHaveURL(/\/console$/);
  const who = page.getByTestId("signed-in-as");
  await expect(who).toContainText(VIEWER.name);
  await expect(who).toContainText("Viewer");
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Members" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Invitations" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Payslip access" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Run payroll" })).toHaveCount(0);
  await page.goto("/console/runs/new");
  await expect(page.getByRole("heading", { name: "Your role cannot run payroll" })).toBeVisible();
  // The service, not the page, is what refuses: a write through the proxy is 403 forbidden.
  const refused = await page.request.post(`${BASE}/api/svc/api/runs`, { data: {} });
  expect(refused.status()).toBe(403);
  expect((await refused.json()).error.code).toBe("forbidden");
  const invitations = await page.request.get(`${BASE}/api/svc/api/org/invitations`);
  expect(invitations.status()).toBe(403);
  await page.goto("/console/members");
  await expect(page.getByTestId("member-row")).toHaveCount(2);
  await signOut(page);
});

test("the admin's audit log shows the invitation; run progress streams through the proxy", async ({ page }) => {
  await signIn(page, ADMIN, "/console/audit");
  await expect(page.getByTestId("audit-row").filter({ hasText: `Invited ${VIEWER.email} as viewer` })).toBeVisible();
  await expect(page.getByTestId("audit-row").filter({ hasText: "Joined by invitation" })).toBeVisible();
  const address = process.env.E2E_CONTRACTOR_ADDRESS;
  test.skip(!address, "E2E_CONTRACTOR_ADDRESS (a testnet unified address) is needed for the run stream check");
  const svc = `${BASE}/api/svc/api`;
  const created = await page.request.post(`${svc}/contractors`, {
    data: { name: "Stream Check", unified_address: address, settlement_choice: "hold_zec" },
  });
  expect([201, 409], await created.text()).toContain(created.status());
  const people = await (await page.request.get(`${svc}/contractors`)).json();
  const person = people.contractors.find((c: { name: string }) => c.name === "Stream Check");
  const run = await page.request.post(`${svc}/runs`, {
    data: {
      period_start: "2026-10-01",
      period_end: "2026-10-31",
      lines: [{ contractor_id: person.id, amount_usd_cents: 100_00, invoice_ref: "E2E-1" }],
      idempotency_key: `e2e-auth-${Date.now()}`,
      allow_overlap: true,
    },
  });
  expect(run.status(), await run.text()).toBe(201);
  const runId = (await run.json()).id as string;
  // The first frames arrive while the stream is still open: nothing in between buffers it.
  const first = await page.evaluate(async (url) => {
    const res = await fetch(url);
    const reader = res.body!.getReader();
    const { value } = await reader.read();
    await reader.cancel();
    return { type: res.headers.get("content-type"), text: new TextDecoder().decode(value) };
  }, `${svc}/runs/${runId}/events`);
  expect(first.type).toContain("text/event-stream");
  expect(first.text).toContain("event: snapshot");
  await page.goto(`/console/runs/${runId}`);
  await expect(page.getByText("Stream Check").first()).toBeVisible();
  const cancelled = await page.request.post(`${svc}/runs/${runId}/cancel`, { data: {} });
  expect(cancelled.status()).toBe(200);
  await page.goto("/console/audit");
  await expect(page.getByTestId("audit-row").filter({ hasText: "Cancelled a run" }).first()).toBeVisible();
  await signOut(page);
});

/** Invites `user` as `role` through the proxy (the admin's session) and returns the invite link. */
async function invite(page: Page, user: typeof ANN, role: "approver"): Promise<string> {
  const r = await page.request.post(`${BASE}/api/svc/api/org/invitations`, { data: { email: user.email, role } });
  expect(r.status(), await r.text()).toBe(201);
  return `${BASE}/invite/${(await r.json()).token as string}`;
}

/** Signs `user` in and joins through their invite link, landing in the console. */
async function join(page: Page, user: typeof ANN, link: string) {
  await signIn(page, user);
  await expect(page.getByRole("heading", { name: "You are not a member yet" })).toBeVisible();
  await page.goto(link);
  await expect(page.getByText("You joined as approver")).toBeVisible();
  await page.getByRole("button", { name: "Open the console" }).click();
  await expect(page).toHaveURL(/\/console$/);
}

test("recorded approvals: the admin's run needs two other approvers before it can be paid", async ({
  page,
  request,
}) => {
  const address = process.env.E2E_CONTRACTOR_ADDRESS;
  test.skip(!address, "E2E_CONTRACTOR_ADDRESS (a testnet unified address) is needed to create a run");
  const svc = `${BASE}/api/svc/api`;
  await signUp(request, ANN);
  await signUp(request, BEN);

  // The admin: the policy is two approvals, which they cannot give to their own run.
  await signIn(page, ADMIN);
  const health = await (await page.request.get(`${svc}/health`)).json();
  expect(health.approvals_required).toBe(2);
  const annLink = await invite(page, ANN, "approver");
  const benLink = await invite(page, BEN, "approver");
  const created = await page.request.post(`${svc}/contractors`, {
    data: { name: "Stream Check", unified_address: address, settlement_choice: "hold_zec" },
  });
  expect([201, 409], await created.text()).toContain(created.status());
  const people = await (await page.request.get(`${svc}/contractors`)).json();
  const person = people.contractors.find((c: { name: string }) => c.name === "Stream Check");

  // Run payroll: with two approvals required, Review sends the run for approval instead of approving.
  await page.goto("/console/runs/new");
  await expect(page.getByRole("heading", { level: 1, name: "Amounts" })).toBeVisible();
  // One line, for Stream Check; anyone else on the list is left out of this run.
  for (const c of people.contractors as { id: string }[]) {
    const include = page.locator(`#include-${c.id}`);
    if (c.id === person.id) {
      if (!(await include.isChecked())) await include.check();
      await page.locator(`#amount-${c.id}`).fill("100");
      await page.locator(`#invoice-${c.id}`).fill("E2E-APPROVALS");
    } else if (await include.isChecked()) {
      await include.uncheck();
    }
  }
  const confirm = page.getByLabel(/This is an extra run for the same period/);
  if (await confirm.isVisible()) await confirm.check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^Review payroll for / })).toBeVisible();
  const send = page.getByRole("button", { name: "Send for approval" });
  await expect(send).toBeEnabled();
  await expect(page.getByText(/Two other admins or approvers must approve the run/)).toBeVisible();
  await send.click();
  await expect(page).toHaveURL(/\?run=[0-9a-f-]{36}/);
  const runId = new URL(page.url()).searchParams.get("run")!;

  // The run page: nothing approved, and the creator is told why they cannot approve.
  await page.goto(`/console/runs/${runId}`);
  const approvals = page.getByTestId("run-approvals");
  await expect(approvals).toContainText("Waiting for two approvals.");
  await expect(approvals).toContainText("You created this run");
  await expect(approvals.getByRole("button", { name: "Approve" })).toHaveCount(0);
  const run = await (await page.request.get(`${svc}/runs/${runId}`)).json();
  expect(run.approvals_required).toBe(2);
  expect(run.approvals).toEqual([]);
  expect(typeof run.created_by).toBe("string");
  // The service, not the page, holds the line: execute and the creator's approval are refused.
  const early = await page.request.post(`${svc}/runs/${runId}/execute`, { data: {} });
  expect(early.status()).toBe(409);
  const earlyBody = await early.json();
  expect(earlyBody.error.code).toBe("approvals_required");
  expect(earlyBody.error.message).toContain("2 more approvals");
  const own = await page.request.post(`${svc}/runs/${runId}/approve`, { data: {} });
  expect(own.status()).toBe(403);
  expect((await own.json()).error.code).toBe("creator_cannot_approve");
  await signOut(page);

  // The first approver.
  await join(page, ANN, annLink);
  await page.goto(`/console/runs/${runId}`);
  await expect(approvals).toContainText("Waiting for two approvals.");
  await approvals.getByRole("button", { name: "Approve" }).click();
  await expect(approvals).toContainText("Approved by Ann Approver, waiting for one more.");
  await expect(approvals).toContainText("You approved it");
  await expect(approvals.getByRole("button", { name: "Approve" })).toHaveCount(0);
  const half = await page.request.post(`${svc}/runs/${runId}/execute`, { data: {} });
  expect(half.status()).toBe(409);
  expect((await half.json()).error.message).toContain("1 more approval");
  await page.getByRole("tab", { name: "Audit trail" }).click();
  // The timeline entry (the raw service log behind the disclosure carries the same words).
  const timeline = page.locator('ol[aria-label^="Activity of the"]');
  await expect(timeline.getByText("Approved by Ann Approver (approver)")).toBeVisible();
  await expect(timeline.getByText("Approval 1 of 2.")).toBeVisible();
  await signOut(page);

  // The second approver: the count is met, and what the run still needs is funding.
  await join(page, BEN, benLink);
  await page.goto(`/console/runs/${runId}`);
  await expect(approvals).toContainText("Approved by Ann Approver, waiting for one more.");
  await approvals.getByRole("button", { name: "Approve" }).click();
  await expect(approvals).toContainText("Approved by Ann Approver and Ben Approver.");
  await expect(approvals.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Approved, not funded yet" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Fund run" })).toBeVisible();
  const approved = await page.request.post(`${svc}/runs/${runId}/execute`, { data: {} });
  expect(approved.status()).toBe(409);
  expect((await approved.json()).error.code).toBe("not_funded");
  const again = await page.request.post(`${svc}/runs/${runId}/approve`, { data: {} });
  expect(again.status()).toBe(409);
  expect((await again.json()).error.code).toBe("already_approved");
  await signOut(page);

  // The admin's audit log has one row per approval.
  await signIn(page, ADMIN, "/console/audit");
  await expect(page.getByTestId("audit-row").filter({ hasText: "Approved a payroll run" })).toHaveCount(2);
  await signOut(page);
});
