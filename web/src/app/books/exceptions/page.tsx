import type { Metadata } from "next";
import { ExceptionsPage } from "@/components/books/pages";

export const metadata: Metadata = { title: "Exceptions" };

export default function BooksExceptions() {
  return <ExceptionsPage />;
}
