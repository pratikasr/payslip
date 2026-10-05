import type { Metadata } from "next";
import { PortalHome } from "@/components/portal/portal-home";

// The layout's title template applies to child segments only, so this page names itself in full.
export const metadata: Metadata = { title: { absolute: "Your payslips | Payslip" } };

export default function PortalHomePage() {
  return <PortalHome />;
}
