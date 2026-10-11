import { authRequired } from "@/lib/auth-config";
import { getAuth } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Better Auth's routes (sign-in, callback, session, sign-out, JWKS, token). With sign-in off
 * they do not exist, so a deployment that never configured sign-in exposes nothing here.
 */
async function handler(request: Request): Promise<Response> {
  if (!authRequired()) {
    return Response.json(
      {
        error: {
          code: "not_found",
          message: "Sign-in is off on this deployment.",
          hint: "Set PAYSLIP_AUTH=required on the web app and the service to turn it on.",
        },
      },
      { status: 404 },
    );
  }
  const auth = await getAuth();
  return auth.handler(request);
}

export { handler as GET, handler as POST };
