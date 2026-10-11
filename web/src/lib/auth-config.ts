import "server-only";

/*
  Sign-in settings, read on the server only (ADR-026). PAYSLIP_AUTH mirrors the service's
  setting: with `required` the browser talks to the service through /api/svc, which attaches a
  token for the signed-in member; with `off` (the default) nothing changes for anyone.
*/

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

/** True when PAYSLIP_AUTH=required: console pages need a signed-in member. */
export function authRequired(): boolean {
  return env("PAYSLIP_AUTH") === "required";
}

/** The email-and-password sign-in for browser tests (PAYSLIP_AUTH_TEST_LOGIN=1). Never in production. */
export function testLoginEnabled(): boolean {
  return env("PAYSLIP_AUTH_TEST_LOGIN") === "1";
}

/** Whether a Google OAuth client is configured. */
export function googleConfigured(): boolean {
  return !!env("GOOGLE_CLIENT_ID") && !!env("GOOGLE_CLIENT_SECRET");
}

/** The web app's own public address, which Google redirects back to (BETTER_AUTH_URL). */
export function appUrl(): string {
  return (env("BETTER_AUTH_URL") ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
}

/** Where the service listens, for the server side only (PAYSLIP_API_URL, else the public setting). */
export function serviceUrl(): string {
  return (env("PAYSLIP_API_URL") ?? env("NEXT_PUBLIC_PAYSLIP_API_URL") ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
}

/** Where auth.db (sessions, accounts, signing keys) lives: PAYSLIP_AUTH_DB, else ./data/auth.db. */
export function authDbPath(): string {
  return env("PAYSLIP_AUTH_DB") ?? "./data/auth.db";
}

/** The Google Workspace domain sign-in is locked to, if any ("*" accepts any Workspace domain). */
export function workspaceDomain(): string | undefined {
  return env("PAYSLIP_GOOGLE_WORKSPACE_DOMAIN");
}

/** The audience the service checks tokens for (PAYSLIP_AUTH_AUDIENCE on the service side). */
export const SERVICE_AUDIENCE = "payslip-service";
