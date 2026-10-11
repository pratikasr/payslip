import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { TypedFiguresProvider } from "@/components/app/amount";
import { HealthProvider } from "@/components/app/health-provider";
import { AuthProvider } from "@/components/auth/auth-provider";
import { ConsoleGate } from "@/components/console/console-gate";
import { DemoBar } from "@/components/shell/demo-bar";
import type { Me } from "@/lib/api";
import { authRequired } from "@/lib/auth-config";
import { privacyBootScript } from "@/lib/privacy";
import { serverGet, serverServiceHint } from "@/lib/server-api";
import { signedIn } from "@/lib/service-session";

/**
 * Every company page sits under the demo bar; pages in (shell) also get the sidebar. The kind of
 * service (its network, or statements-only) is read on the server, so the first paint names the
 * right network and coin (never a testnet claim on mainnet) and a statements-only deployment
 * never flashes a console.
 *
 * With sign-in required (ADR-026) the console needs a session: without one the person goes to
 * sign in, and with one the layout learns who they are and their role from the service, so the
 * shell can show the organisation and hide what the role cannot do. The demo bar, whose
 * "Viewing as" switch is for the open testnet demo, is not shown.
 */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const required = authRequired();
  let me: Me | null = null;
  if (required) {
    if (!(await signedIn(await headers()))) redirect("/sign-in?next=%2Fconsole");
    me = (await serverGet<Me>("/api/me")) ?? null;
  }
  const hint = await serverServiceHint();
  return (
    <AuthProvider required={required} me={me}>
      <HealthProvider hint={hint}>
        {/* Privacy mode before first paint; see src/lib/privacy.ts. */}
        <script dangerouslySetInnerHTML={{ __html: privacyBootScript }} />
        {required ? null : <DemoBar />}
        {/* Every figure in the console is typed on the form, its cents level (DESIGN.md section 17). */}
        <TypedFiguresProvider>
          <ConsoleGate>{children}</ConsoleGate>
        </TypedFiguresProvider>
      </HealthProvider>
    </AuthProvider>
  );
}
