/*
  Server-side reads for the first paint. A page that renders its data on the
  server shows it without waiting for client JavaScript, and nothing moves when
  it arrives. Any failure returns undefined and the client fetch (with its
  error states) takes over.
*/
import { API_URL } from "@/lib/api";

export async function serverGet<T>(path: string, timeoutMs = 2500): Promise<T | undefined> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok ? ((await res.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}
