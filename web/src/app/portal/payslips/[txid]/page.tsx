import { Suspense } from "react";
import type { Metadata } from "next";
import { PayslipDocument } from "@/components/portal/payslip-document";

/** The document sets "Payslip for <period> | Payslip" once the payment is read. */
export const metadata: Metadata = { title: "Payslip" };

export default async function PayslipPage({ params }: { params: Promise<{ txid: string }> }) {
  const { txid } = await params;
  // The payslip reads ?from=&to= (a payment found in Tax documents), so it waits for the URL.
  return (
    <Suspense>
      <PayslipDocument txid={decodeURIComponent(txid).toLowerCase()} />
    </Suspense>
  );
}
