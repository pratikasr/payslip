import type { Metadata } from "next";
import { ReconciliationPage } from "@/components/books/pages";

export const metadata: Metadata = { title: "Reconciliation" };

export default function BooksReconciliation() {
  return <ReconciliationPage />;
}
