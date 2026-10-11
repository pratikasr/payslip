import Link from "next/link";
import { DocumentTitle } from "@/components/portal/document-title";
import { TypedNotice } from "@/components/portal/paper-parts";
import { Button } from "@/components/ui/button";

export default function BooksNotFound() {
  return (
    <>
      <DocumentTitle title="Page not found | Books | Payslip" />
      <TypedNotice
        title="Page not found"
        reference="Books"
        actions={
          <Button asChild variant="secondary">
            <Link href="/books">Back to the reconciliation</Link>
          </Button>
        }
      >
        <p>This page is not part of the books. Check the address.</p>
      </TypedNotice>
    </>
  );
}
