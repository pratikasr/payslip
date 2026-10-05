import type { Metadata } from "next";
import { HealthProvider } from "@/components/app/health-provider";
import { PortalFrame } from "@/components/portal/portal-frame";
import { PortalProvider } from "@/components/portal/portal-provider";
import { DemoBar } from "@/components/shell/demo-bar";

export const metadata: Metadata = {
  title: { default: "Your payslips", template: "%s | Payslip" },
  description: "Your payslips from Payslip, read from the Zcash chain with your viewing key.",
};

/** The contractor portal: the demo bar, then either the unlock card or the contractor's own shell. */
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <HealthProvider>
      <DemoBar />
      <PortalProvider>
        <PortalFrame>{children}</PortalFrame>
      </PortalProvider>
    </HealthProvider>
  );
}
