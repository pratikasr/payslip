import { HealthProvider } from "@/components/app/health-provider";

/**
 * The public payslip has no app chrome and no demo bar: it is what a landlord, a bank or a visa
 * office opens from a proof link. HealthProvider only names the coin (TAZ on testnet, ZEC).
 */
export default function VerifyLayout({ children }: { children: React.ReactNode }) {
  return (
    <HealthProvider>
      <main id="main">{children}</main>
    </HealthProvider>
  );
}
