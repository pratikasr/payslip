import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/app/logo";
import { DemoLink } from "@/components/marketing/demo-link";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: { absolute: "Page not found | Payslip" } };

/** An address that matches nothing: the app's type, and the three places a visitor is likely after. */
export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-4 py-16">
      <Logo />
      <div className="space-y-2">
        <h1 className="text-[1.75rem] leading-tight font-[380] tracking-[-0.015em]">Page not found</h1>
        <p className="text-[0.9375rem] text-muted-foreground">
          This page does not exist. Check the address, or go back to your payroll, your payslips or a payment proof.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <DemoLink liveLabel="Open Payslip" kitLabel="Open the books" />
        </Button>
        <Button asChild variant="secondary">
          <Link href="/verify">Check a payslip</Link>
        </Button>
        <Button asChild variant="ghost">
          <Link href="/">Home</Link>
        </Button>
      </div>
    </main>
  );
}
