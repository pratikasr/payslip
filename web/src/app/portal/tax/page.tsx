import type { Metadata } from "next";
import { TaxDocuments } from "@/components/portal/tax-documents";

export const metadata: Metadata = { title: "Tax documents" };

export default function TaxPage() {
  return <TaxDocuments />;
}
