/*
  Server-side reads for the first paint. A page that renders its data on the server shows it
  without waiting for client JavaScript, and nothing moves when it arrives. Any failure returns
  undefined and the client fetch (with its error states) takes over.

  With sign-in required (ADR-026) the server attaches the signed-in member's token, exactly as
  the browser's calls get one through /api/svc; without a session the payer routes answer 401
  and the page renders without its first-paint data.
*/
import { headers } from "next/headers";
import { API_URL, type Network, type TreasuryKeyState } from "@/lib/api";
import { authRequired } from "@/lib/auth-config";
import { serviceToken } from "@/lib/service-session";

/*
  Where the server-side reads go. A hosted deployment gives the browser the page's own origin
  (NEXT_PUBLIC_PAYSLIP_API_URL=/), which the Next server cannot use, so PAYSLIP_API_INTERNAL_URL
  names the service directly (deploy/compose.yml). Read when the server starts, never inlined into
  the browser bundle; empty falls back to API_URL, which is right for a local run. The sign-in
  proxy (/api/svc) reaches the service the same way (lib/auth-config.ts serviceUrl()).
*/
const SERVER_API_URL = (process.env.PAYSLIP_API_INTERNAL_URL?.trim() || API_URL).replace(/\/+$/, "");

async function requestHeaders(): Promise<Record<string, string>> {
  const h: Record<string, string> = { Accept: "application/json" };
  if (!authRequired()) return h;
  try {
    const token = await serviceToken(await headers());
    if (token) h.Authorization = `Bearer ${token}`;
  } catch {
    // No session or sign-in not configured: the request goes without a token.
  }
  return h;
}

export async function serverGet<T>(path: string, timeoutMs = 2500): Promise<T | undefined> {
  try {
    const res = await fetch(`${SERVER_API_URL}${path}`, {
      cache: "no-store",
      headers: await requestHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok ? ((await res.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

type Hint = { network?: Network; mode: "full" | "statements"; treasury?: TreasuryKeyState };

/** The last hint this server process learnt: a deployment's network and mode do not change. */
let known: Hint | undefined;

async function probe(path: string, timeoutMs: number): Promise<{ ok: boolean; status: number; body: unknown }> {
  try {
    const res = await fetch(`${SERVER_API_URL}${path}`, {
      cache: "no-store",
      headers: await requestHeaders(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

function statementsOnly(r: { status: number; body: unknown }): boolean {
  return r.status === 404 && (r.body as { error?: { code?: string } } | null)?.error?.code === "statements_only";
}

/**
 * Which kind of service this is, without waiting for GET /api/health (it asks lightwalletd and can
 * take seconds). GET /api/contractors answers from the database in milliseconds and says whether
 * the service is statements-only (404 statements_only); GET /api/wallet names the network, and
 * the last answer is remembered for when the wallet is busy syncing. Undefined when the service
 * cannot be reached.
 */
export async function serverServiceHint(timeoutMs = 1500): Promise<Hint | undefined> {
  const [people, wallet, key] = await Promise.all([
    probe("/api/contractors", timeoutMs),
    probe("/api/wallet", timeoutMs),
    // The treasury key's state (no_key, locked, unlocked): a file and a clock, answered at once.
    // Older services have no such route; a deployment with no key yet has no wallet to probe.
    probe("/api/treasury/key", timeoutMs),
  ]);
  let hint: Hint | undefined;
  if (statementsOnly(people) || statementsOnly(wallet)) hint = { mode: "statements" };
  else if (people.ok || wallet.ok || key.ok) {
    const net = (wallet.body as { network?: string } | null)?.network;
    const network = wallet.ok && (net === "mainnet" || net === "testnet") ? net : known?.network;
    const state = key.ok ? (key.body as { state?: string } | null)?.state : undefined;
    const treasury =
      state === "no_key" || state === "locked" || state === "unlocked" || state === "unlocked_by_env"
        ? state
        : undefined;
    hint = { mode: "full", network, ...(treasury ? { treasury } : {}) };
  }
  // The network and mode of a deployment never change; the key's state does, so it is not kept.
  if (hint) known = hint.network || hint.mode === "statements" ? { ...hint, treasury: undefined } : (known ?? hint);
  return hint;
}
