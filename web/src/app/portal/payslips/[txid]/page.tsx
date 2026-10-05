import type { Metadata } from "next";
import { PayslipDocument } from "@/components/portal/payslip-document";

export const metadata: Metadata = { title: "Payslip" };

export default async function PayslipPage({ params }: { params: Promise<{ txid: string }> }) {
  const { txid } = await params;
  return <PayslipDocument txid={decodeURIComponent(txid).toLowerCase()} />;
}
