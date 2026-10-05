import type { Metadata } from "next";
import { LedgerPage } from "@/components/books/pages";

export const metadata: Metadata = { title: "Ledger" };

export default function BooksLedger() {
  return <LedgerPage />;
}
