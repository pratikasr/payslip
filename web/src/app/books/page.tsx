import type { Metadata } from "next";
import { ReconciliationPage } from "@/components/books/pages";

// The layout's title template applies to child segments only, so this page names itself in full.
export const metadata: Metadata = { title: { absolute: "Reconciliation | Books | Payslip" } };

export default function BooksReconciliation() {
  return <ReconciliationPage />;
}
