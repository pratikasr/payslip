import type { Metadata } from "next";
import { AccountantView } from "@/components/statement/accountant-view";

export const metadata: Metadata = { title: "Accountant reconciliation" };

export default function AccountantPage() {
  return <AccountantView />;
}
