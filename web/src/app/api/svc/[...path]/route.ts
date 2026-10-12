import { authRequired, serviceUrl } from "@/lib/auth-config";
import { serviceToken } from "@/lib/service-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
  The same-origin proxy to the Payslip service (ADR-026). With sign-in required the browser never
  talks to the service: every call goes to /api/svc/api/..., this handler attaches a bearer token
  for the signed-in member and streams the answer back, run progress (Server-Sent Events)
  included. The token never reaches browser JavaScript, and the service stays on loopback.
*/

const WRITES = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/** Headers forwarded upstream, if present. */
const REQUEST_HEADERS = ["content-type", "accept", "accept-language", "last-event-id"];

/** Headers passed back to the browser, if present. */
const RESPONSE_HEADERS = ["content-type", "content-disposition", "cache-control", "allow", "retry-after"];

function apiError(status: number, code: string, message: string, hint: string): Response {
  return Response.json({ error: { code, message, hint } }, { status });
}

/** True when a state-changing request comes from this app's own pages, not another site. */
function sameOrigin(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none";
  const origin = req.headers.get("origin");
  if (!origin) return true;
  return origin === new URL(req.url).origin;
}

async function proxy(req: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  if (path[0] !== "api") {
    return apiError(404, "not_found", `There is no /${path.join("/")} on this service.`, "Use /api/svc/api/...");
  }
  if (WRITES.has(req.method) && !sameOrigin(req)) {
    return apiError(
      403,
      "forbidden",
      "Cross-site requests are not accepted.",
      "Send the request from the Payslip app.",
    );
  }
  const url = new URL(req.url);
  const target = `${serviceUrl()}/${path.map(encodeURIComponent).join("/")}${url.search}`;
  const headers = new Headers();
  for (const h of REQUEST_HEADERS) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (authRequired()) {
    const token = await serviceToken(req.headers);
    if (token) headers.set("authorization", `Bearer ${token}`);
  }
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
      // @ts-expect-error Node's fetch needs this to stream a request body.
      duplex: "half",
      redirect: "manual",
      cache: "no-store",
      signal: req.signal,
    });
  } catch {
    return apiError(
      502,
      "service_unreachable",
      "The Payslip service is not answering.",
      "Start it with: cd service && cargo run. If it is running, check PAYSLIP_API_INTERNAL_URL on the web app.",
    );
  }
  const out = new Headers();
  for (const h of RESPONSE_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) out.set(h, v);
  }
  if (upstream.headers.get("content-type")?.startsWith("text/event-stream")) {
    // Nothing between the service and the browser may buffer a progress stream.
    out.set("cache-control", "no-cache, no-transform");
    out.set("x-accel-buffering", "no");
  }
  return new Response(upstream.status === 204 ? null : upstream.body, { status: upstream.status, headers: out });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as PATCH, proxy as DELETE };
