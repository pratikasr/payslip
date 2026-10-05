import type { Metadata } from "next";
import { PayslipList } from "@/components/portal/payslip-list";

export const metadata: Metadata = { title: "Payslips" };

export default function PayslipsPage() {
  return <PayslipList />;
}
