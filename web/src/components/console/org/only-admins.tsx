"use client";

import Link from "next/link";
import { useAuth } from "@/components/auth/auth-provider";
import { Card } from "@/components/ds/card";
import { PageTitle } from "@/components/ds/page";
import { Button } from "@/components/ui/button";
import { roleLabel } from "@/lib/roles";

/** What a page says to a role that cannot use it: the role, what it may do, and who to ask. */
export function OnlyAdmins({ what, who = "an admin" }: { what: string; who?: string }) {
  const auth = useAuth();
  return (
    <>
      <PageTitle title="Not for your role" />
      <Card>
        <p className="text-[0.9375rem]">
          Only {who} can {what}. You are signed in as {roleLabel(auth.role).toLowerCase() || "a member"}.
        </p>
        <p className="mt-1 text-[0.8125rem] text-muted-foreground">An admin can change your role under Members.</p>
        <div className="mt-5 border-t border-hairline pt-4">
          <Button asChild variant="secondary">
            <Link href="/console">Back to the console</Link>
          </Button>
        </div>
      </Card>
    </>
  );
}
