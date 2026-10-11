/*
  Server-side reads for the first paint. A page that renders its data on the server shows it
  without waiting for client JavaScript, and nothing moves when it arrives. Any failure returns
  undefined and the client fetch (with its error states) takes over.
*/
import { API_URL, type Network } from "@/lib/api";

/*
  Where the server-side reads go. A hosted deployment gives the browser the page's own origin
  (NEXT_PUBLIC_PAYSLIP_API_URL=/), which the Next server cannot use, so PAYSLIP_API_INTERNAL_URL
  names the service directly (deploy/compose.yml). Read when the server starts, never inlined into
  the browser bundle; empty falls back to API_URL, which is right for a local run.
*/
const SERVER_API_URL = (process.env.PAYSLIP_API_INTERNAL_URL?.trim() || API_URL).replace(/\/+$/, "");

export async function serverGet<T>(path: string, timeoutMs = 2500): Promise<T | undefined> {
  try {
    const res = await fetch(`${SERVER_API_URL}${path}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok ? ((await res.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}

type Hint = { network?: Network; mode: "full" | "statements" };

/** The last hint this server process learnt: a deployment's network and mode do not change. */
let known: Hint | undefined;

async function probe(path: string, timeoutMs: number): Promise<{ ok: boolean; status: number; body: unknown }> {
  try {
    const res = await fetch(`${SERVER_API_URL}${path}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
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
  const [people, wallet] = await Promise.all([probe("/api/contractors", timeoutMs), probe("/api/wallet", timeoutMs)]);
  let hint: Hint | undefined;
  if (statementsOnly(people) || statementsOnly(wallet)) hint = { mode: "statements" };
  else if (people.ok || wallet.ok) {
    const net = (wallet.body as { network?: string } | null)?.network;
    const network = wallet.ok && (net === "mainnet" || net === "testnet") ? net : known?.network;
    hint = { mode: "full", network };
  }
  if (hint) known = hint.network || hint.mode === "statements" ? hint : (known ?? hint);
  return hint;
}
