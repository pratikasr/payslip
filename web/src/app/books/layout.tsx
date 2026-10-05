import type { Metadata } from "next";
import { HealthProvider } from "@/components/app/health-provider";
import { BooksFrame } from "@/components/books/books-frame";
import { BooksProvider } from "@/components/books/books-provider";
import { DemoBar } from "@/components/shell/demo-bar";

export const metadata: Metadata = { title: { default: "Books", template: "%s | Books | Payslip" } };

/** The accountant workspace: demo bar, then the Books shell around a key set held for this tab. */
export default function BooksLayout({ children }: { children: React.ReactNode }) {
  return (
    <HealthProvider>
      <DemoBar />
      <BooksProvider>
        <BooksFrame>{children}</BooksFrame>
      </BooksProvider>
    </HealthProvider>
  );
}
