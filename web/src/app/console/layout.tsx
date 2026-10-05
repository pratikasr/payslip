import { HealthProvider } from "@/components/app/health-provider";
import { DemoBar } from "@/components/shell/demo-bar";

/** Every company page sits under the demo bar; pages in (shell) also get the sidebar. */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <HealthProvider>
      <DemoBar />
      {children}
    </HealthProvider>
  );
}
