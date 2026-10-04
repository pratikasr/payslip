import type { Metadata } from "next";
import { ContractorsView } from "@/components/payer/contractors-view";

export const metadata: Metadata = { title: "Contractors" };

export default function ContractorsPage() {
  return <ContractorsView />;
}
