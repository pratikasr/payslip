import "server-only";

import { authRequired } from "@/lib/auth-config";
import { sessionOf, tokenFor } from "@/lib/auth";

/*
  The token the proxy and server renders attach to service requests. Minting signs a JWT, so a
  token is reused for the same session until it is about to expire (tokens last 5 minutes;
  this keeps them for 4). The cache is per server process and holds nothing the browser sees.
*/

const TOKEN_TTL_MS = 4 * 60 * 1000;

const cache = new Map<string, { token: string; until: number }>();

/** The session cookie's value, which names a session without reading the database. */
function sessionKey(headers: Headers): string | null {
  const cookie = headers.get("cookie") ?? "";
  const m = /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=([^;]+)/.exec(cookie);
  return m ? m[1] : null;
}

/** A bearer token for the service, or null when nobody is signed in (or sign-in is off). */
export async function serviceToken(headers: Headers): Promise<string | null> {
  if (!authRequired()) return null;
  const key = sessionKey(headers);
  if (!key) return null;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.token;
  const token = await tokenFor(headers);
  if (!token) {
    cache.delete(key);
    return null;
  }
  if (cache.size > 1000) cache.clear();
  cache.set(key, { token, until: Date.now() + TOKEN_TTL_MS });
  return token;
}

/** Whether `headers` carry a live session. */
export async function signedIn(headers: Headers): Promise<boolean> {
  if (!authRequired()) return false;
  try {
    return !!(await sessionOf(headers));
  } catch {
    return false;
  }
}
