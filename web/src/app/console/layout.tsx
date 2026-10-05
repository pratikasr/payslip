import { HealthProvider } from "@/components/app/health-provider";
import { ConsoleGate } from "@/components/console/console-gate";
import { DemoBar } from "@/components/shell/demo-bar";
import { privacyBootScript } from "@/lib/privacy";
import { serverServiceHint } from "@/lib/server-api";

/**
 * Every company page sits under the demo bar; pages in (shell) also get the sidebar. The kind of
 * service (its network, or statements-only) is read on the server, so the first paint names the
 * right network and coin (never a testnet claim on mainnet) and a statements-only deployment
 * never flashes a console.
 */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const hint = await serverServiceHint();
  return (
    <HealthProvider hint={hint}>
      {/* Privacy mode before first paint; see src/lib/privacy.ts. */}
      <script dangerouslySetInnerHTML={{ __html: privacyBootScript }} />
      <DemoBar />
      <ConsoleGate>{children}</ConsoleGate>
    </HealthProvider>
  );
}
