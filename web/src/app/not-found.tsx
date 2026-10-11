import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/app/logo";
import { Sheet } from "@/components/ds/paper";
import { DemoLink } from "@/components/marketing/demo-link";
import { TypedNotice } from "@/components/portal/paper-parts";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: { absolute: "Page not found | Payslip" } };

/**
 * An address that matches nothing: a typed notice on a sheet of continuous paper, and the three
 * places a visitor is likely after.
 */
export default function NotFound() {
  return (
    <main id="main" className="min-h-dvh bg-desk px-2 py-8 sm:px-4 sm:py-16">
      <Sheet className="mx-auto w-full max-w-[760px]">
        <div className="px-2 pt-6 pb-10 sm:px-10 sm:pt-8 sm:pb-12">
          <div className="mb-8">
            <Logo />
          </div>
          <TypedNotice
            title="Page not found"
            reference="Payslip"
            actions={
              <>
                <Button asChild>
                  <DemoLink liveLabel="Open Payslip" kitLabel="Open the books" />
                </Button>
                <Button asChild variant="secondary">
                  <Link href="/verify">Check a payslip</Link>
                </Button>
                <Button asChild variant="ghost">
                  <Link href="/">Home</Link>
                </Button>
              </>
            }
          >
            <p>
              This page does not exist. Check the address, or go back to your payroll, your payslips or a payment proof.
            </p>
          </TypedNotice>
        </div>
      </Sheet>
    </main>
  );
}
