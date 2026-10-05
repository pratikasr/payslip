import type { Metadata } from "next";
import { ExportsPage } from "@/components/books/pages";

export const metadata: Metadata = { title: "Exports" };

export default function BooksExports() {
  return <ExportsPage />;
}
