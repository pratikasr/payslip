import type { Metadata } from "next";
import { VerifyProofView } from "@/components/proof/verify-view";

export const metadata: Metadata = {
  title: "Verify a payment",
  description: "Check one Zcash payment against the chain with a Payslip payment proof.",
};

export default function VerifyPage() {
  return <VerifyProofView />;
}
