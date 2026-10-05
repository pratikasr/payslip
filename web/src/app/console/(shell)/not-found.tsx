import Link from "next/link";
import { PageTitle } from "@/components/ds/page";
import { DocumentTitle } from "@/components/portal/document-title";
import { Button } from "@/components/ui/button";

/** An unknown console address keeps the sidebar and points back to the payroll. */
export default function ConsoleNotFound() {
  return (
    <>
      <DocumentTitle title="Page not found | Payslip" />
      <PageTitle
        title="Page not found"
        description="This page is not part of the company console. Check the address, or go back to your payroll."
      />
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/console">Company home</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/console/runs">Payroll runs</Link>
        </Button>
      </div>
    </>
  );
}
