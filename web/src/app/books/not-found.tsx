import Link from "next/link";
import { PageTitle } from "@/components/ds/page";
import { DocumentTitle } from "@/components/portal/document-title";
import { Button } from "@/components/ui/button";

export default function BooksNotFound() {
  return (
    <>
      <DocumentTitle title="Page not found | Books | Payslip" />
      <PageTitle title="Page not found" description="This page is not part of the books. Check the address." />
      <Button asChild variant="secondary">
        <Link href="/books">Back to the reconciliation</Link>
      </Button>
    </>
  );
}
