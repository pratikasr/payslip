import type { Metadata } from "next";
import { ContractorStatementView } from "@/components/statement/contractor-view";

export const metadata: Metadata = { title: "Contractor statement" };

export default function ContractorPage() {
  return <ContractorStatementView />;
}
