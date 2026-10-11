import type { Metadata } from "next";
import { HealthProvider } from "@/components/app/health-provider";
import { BooksFrame } from "@/components/books/books-frame";
import { BooksProvider } from "@/components/books/books-provider";
import { DemoBar } from "@/components/shell/demo-bar";
import { authRequired } from "@/lib/auth-config";

export const metadata: Metadata = { title: { default: "Books", template: "%s | Books | Payslip" } };

/**
 * The accountant workspace: demo bar, then the Books shell around a key set held for this tab.
 * With sign-in on there is no demo to switch between, so no bar.
 */
export default function BooksLayout({ children }: { children: React.ReactNode }) {
  return (
    <HealthProvider>
      {authRequired() ? null : <DemoBar />}
      <BooksProvider>
        <BooksFrame>{children}</BooksFrame>
      </BooksProvider>
    </HealthProvider>
  );
}
