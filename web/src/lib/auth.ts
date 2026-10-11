import "server-only";

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { nextCookies } from "better-auth/next-js";
import { jwt } from "better-auth/plugins/jwt";
import {
  appUrl,
  authDbPath,
  authRequired,
  googleConfigured,
  SERVICE_AUDIENCE,
  testLoginEnabled,
  workspaceDomain,
} from "@/lib/auth-config";

/*
  Better Auth 1.7.7 (ADR-026): Google sign-in with an optional Workspace domain lock, sessions in
  auth.db (SQLite through node:sqlite, Node 22.16 or newer), and the JWT plugin, which mints short
  EdDSA tokens for the service and publishes the public keys at /api/auth/jwks. The service never
  reads auth.db: it only checks tokens against those keys.

  Built once per server process, on first use, and only when PAYSLIP_AUTH=required.
*/

/** The linked accounts of a user, set once the instance exists (used by the token payload). */
let accountsOf: ((userId: string) => Promise<{ providerId: string; accountId: string }[]>) | undefined;

/**
 * node:sqlite, loaded only when sign-in is on: this module is imported by layouts that run with
 * sign-in off too, and Node before 22.13 has no such built-in (22.16 is needed for the adapter).
 */
async function openDatabase(path: string): Promise<DatabaseSync> {
  const { DatabaseSync } = (await import(/* webpackIgnore: true */ "node:sqlite")) as typeof import("node:sqlite");
  const database = new DatabaseSync(path);
  database.exec("PRAGMA journal_mode = WAL");
  return database;
}

async function buildOptions() {
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  if (!secret) {
    throw new Error("PAYSLIP_AUTH=required needs BETTER_AUTH_SECRET (openssl rand -base64 32).");
  }
  const baseURL = appUrl();
  const dbPath = authDbPath();
  mkdirSync(dirname(dbPath), { recursive: true });
  const database = await openDatabase(dbPath);
  const testLogin = testLoginEnabled();
  const hd = workspaceDomain();
  return {
    appName: "Payslip",
    baseURL,
    secret,
    database,
    trustedOrigins: [baseURL],
    telemetry: { enabled: false },
    socialProviders: googleConfigured()
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID!.trim(),
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!.trim(),
            // Asks only for openid, email and profile (the provider's default scopes), so no
            // Google app verification is needed. `hd` is checked against the ID token's claim.
            ...(hd ? { hd } : {}),
            prompt: "select_account",
          },
        }
      : {},
    // The email-and-password provider exists only for browser tests. Its users count as
    // verified so the service's bootstrap and invitation rules behave as with Google, and the
    // sign-in rate limit (3 per 10 seconds in production) is off for its two paths, since a
    // test suite signs in several times in a row. Google's paths keep their limits.
    emailAndPassword: { enabled: testLogin, minPasswordLength: 8 },
    rateLimit: testLogin ? { customRules: { "/sign-in/email": false, "/sign-up/email": false } } : undefined,
    databaseHooks: testLogin
      ? {
          user: {
            create: {
              before: async (user) => ({ data: { ...user, emailVerified: true } }),
            },
          },
        }
      : undefined,
    plugins: [
      jwt({
        jwt: {
          issuer: baseURL,
          audience: SERVICE_AUDIENCE,
          expirationTime: "5m",
          definePayload: async ({ user, session }) => {
            const accounts = accountsOf ? await accountsOf(user.id) : [];
            const google = accounts.find((a) => a.providerId === "google");
            return {
              email: user.email,
              email_verified: user.emailVerified,
              name: user.name,
              picture: user.image ?? null,
              google_sub: google?.accountId ?? null,
              sid: session.id,
            };
          },
        },
        jwks: { keyPairConfig: { alg: "EdDSA", crv: "Ed25519" } },
      }),
      nextCookies(),
    ],
  } satisfies BetterAuthOptions;
}

function createAuth(options: Awaited<ReturnType<typeof buildOptions>>) {
  const auth = betterAuth(options);
  accountsOf = async (userId) => (await auth.$context).internalAdapter.findAccounts(userId);
  return auth;
}

type Auth = ReturnType<typeof createAuth>;

let instance: Promise<Auth> | undefined;

/** The Better Auth instance, created on first use with its tables migrated. */
export function getAuth(): Promise<Auth> {
  if (!authRequired()) {
    return Promise.reject(new Error("Sign-in is off on this deployment (PAYSLIP_AUTH is not required)."));
  }
  instance ??= (async () => {
    const options = await buildOptions();
    const { runMigrations } = await getMigrations(options);
    await runMigrations();
    return createAuth(options);
  })();
  return instance;
}

/** The signed-in person's session, or null; `headers` are the incoming request's. */
export async function sessionOf(headers: Headers) {
  const auth = await getAuth();
  return auth.api.getSession({ headers });
}

/** A fresh token for the service, for the session in `headers`; null without a session. */
export async function tokenFor(headers: Headers): Promise<string | null> {
  const auth = await getAuth();
  try {
    const { token } = await auth.api.getToken({ headers });
    return token || null;
  } catch {
    return null;
  }
}
