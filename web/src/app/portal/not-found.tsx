import Link from "next/link";
import { DocumentTitle } from "@/components/portal/document-title";
import { TypedNotice } from "@/components/portal/paper-parts";
import { Button } from "@/components/ui/button";

export default function PortalNotFound() {
  return (
    <>
      <DocumentTitle title="Page not found | Payslip" />
      <TypedNotice
        title="Page not found"
        reference="Your payslips"
        actions={
          <Button asChild variant="secondary">
            <Link href="/portal">Back to your payslips</Link>
          </Button>
        }
      >
        <p>This page is not part of your payslips. Check the address.</p>
      </TypedNotice>
    </>
  );
}
