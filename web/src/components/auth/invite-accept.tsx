"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SlipHead } from "@/components/app/logo";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Card } from "@/components/ds/card";
import { Button } from "@/components/ui/button";
import { Problem } from "@/components/runs/problem";
import { api, toDisplayError, type ApiError, type Membership } from "@/lib/api";
import { roleLabel } from "@/lib/roles";
import { TYPE } from "@/components/ds/type";
import { cn } from "cn";

/** Accepts the invitation once, says what happened, and opens the console. */
export function InviteAccept({ token }: { token: string }) {
  const router = useRouter();
  const [state, setState] = useState<{ membership?: Membership; error?: ApiError }>({});
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api
      .acceptInvitation(token)
      .then((r) => setState({ membership: r.membership }))
      .catch((err) => setState({ error: toDisplayError(err) }));
  }, [token]);

  const membership = state.membership;
  const error = state.error;
  // Already a member: the link did its job earlier, so the console is the right place.
  const alreadyIn = error?.code === "already_a_member";
  return (
    <Card className="sheet-shadow px-6 py-7 sm:px-8" aria-live="polite">
      <SlipHead label="Invitation" />
      {membership ? (
        <>
          <h1 className={cn(TYPE.title, "mt-5")}>Welcome to {membership.org.name}</h1>
          <p className="mt-2 text-[0.9375rem] text-muted-foreground">
            You joined as {roleLabel(membership.role).toLowerCase()}.
          </p>
          <div className="mt-6 border-t border-ink pt-6">
            <Button
              onClick={() => {
                router.push("/console");
                router.refresh();
              }}
            >
              Open the console
            </Button>
          </div>
        </>
      ) : error ? (
        <>
          <h1 className={cn(TYPE.title, "mt-5")}>
            {alreadyIn ? "You are already a member" : "This invitation cannot be used"}
          </h1>
          <div className="mt-4">
            <Problem error={error} />
          </div>
          <div className="mt-6 flex flex-wrap gap-2 border-t border-ink pt-6">
            {alreadyIn ? (
              <Button asChild>
                <Link href="/console">Open the console</Link>
              </Button>
            ) : (
              <SignOutButton variant="secondary" size="default" />
            )}
          </div>
        </>
      ) : (
        <>
          <h1 className={cn(TYPE.title, "mt-5")}>Joining</h1>
          <p className="mt-2 text-[0.9375rem] text-muted-foreground">Checking your invitation.</p>
        </>
      )}
    </Card>
  );
}
