import type { Metadata } from "next";
import { PublicPayslip } from "@/components/verify/public-payslip";

export const metadata: Metadata = {
  title: "Payslip",
  description: "Check one Zcash payment against the chain with a Payslip payment proof.",
};

export default function VerifyPage() {
  return <PublicPayslip />;
}
