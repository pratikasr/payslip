/*
  Where links meant for other people point. A payer usually runs the console on their own
  machine (127.0.0.1), which a contractor cannot open; NEXT_PUBLIC_PAYSLIP_PORTAL_URL names a
  Payslip deployment contractors can reach (for example a statements-only one), and invite and
  proof links are built on it. Unset, links use the page's own origin.
*/

/** The configured portal origin ("https://pay.example.com"), or null when unset or not a URL. */
export function configuredPortalOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_PAYSLIP_PORTAL_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** The configured company console origin ("https://app.example.com"), or null when unset or not a URL. */
export function configuredConsoleOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_PAYSLIP_CONSOLE_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/*
  Links that must land on the right host whatever page they sit on: the company console on the
  console origin, the portal and Books on the portal origin. Built only from the configured
  origins, so the server and the browser render the same href; unset, they stay relative.
*/
export function consoleHref(path = "/console"): string {
  const origin = configuredConsoleOrigin();
  return origin ? `${origin}${path}` : path;
}
export function portalHref(path = "/portal"): string {
  const origin = configuredPortalOrigin();
  return origin ? `${origin}${path}` : path;
}
/** A link shown as text: "app.payslip.cash/console", or the path alone when relative. */
export function hrefLabel(href: string): string {
  return href.replace(/^https?:\/\//, "");
}

/** The origin for links other people open: the configured portal, else this page's origin. */
export function publicOrigin(): string {
  const configured = configuredPortalOrigin();
  if (configured) return configured;
  return typeof window === "undefined" ? "" : window.location.origin;
}

/** A link for someone else to open, e.g. publicUrl("/verify#pp1...") or publicUrl("/portal#key=..."). */
export function publicUrl(pathAndHash: string): string {
  return `${publicOrigin()}${pathAndHash.startsWith("/") ? "" : "/"}${pathAndHash}`;
}

/**
 * True when this page is served from the configured portal origin. That deployment is for
 * contractors: it must not lead to the company console or to the company's keys.
 */
export function isPortalOrigin(): boolean {
  const configured = configuredPortalOrigin();
  return !!configured && typeof window !== "undefined" && window.location.origin === configured;
}

/**
 * True for an origin only this machine or its local network can open (loopback, private IPv4,
 * .local names): links built on it do not work on a contractor's own device.
 */
export function isPrivateOrigin(origin: string): boolean {
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "[::1]") return true;
  const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || a === 0;
}

/**
 * A free testnet faucet (0.125 TAZ per IP address per day), verified 5 Oct 2026 and recorded in
 * docs/TECH-DECISIONS.md. Testnet coins have no value; this only matters on testnet.
 */
export const TESTNET_FAUCET_URL = "https://faucet.testnet.valargroup.dev/";
