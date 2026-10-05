import Link from "next/link";
import { PageTitle } from "@/components/ds/page";
import { DocumentTitle } from "@/components/portal/document-title";
import { Button } from "@/components/ui/button";

export default function PortalNotFound() {
  return (
    <>
      <DocumentTitle title="Page not found | Payslip" />
      <PageTitle title="Page not found" description="This page is not part of your payslips. Check the address." />
      <Button asChild variant="secondary">
        <Link href="/portal">Back to your payslips</Link>
      </Button>
    </>
  );
}
