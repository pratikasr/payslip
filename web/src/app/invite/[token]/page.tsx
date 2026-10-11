import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogoMark } from "@/components/app/logo";
import { InviteAccept } from "@/components/auth/invite-accept";
import { Card } from "@/components/ds/card";
import { Button } from "@/components/ui/button";
import { authRequired } from "@/lib/auth-config";
import { signedIn } from "@/lib/service-session";

export const metadata: Metadata = { title: "Join the organisation" };

/**
 * An invitation link. The person signs in first (the link is kept as `next`), then the page
 * accepts the invitation with their session through the proxy and opens the console.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!authRequired()) {
    return (
      <main id="main" className="mx-auto grid min-h-dvh max-w-[480px] content-center px-4 py-12">
        <Card className="px-6 py-7 sm:px-8">
          <LogoMark className="size-[30px]" />
          <h1 className="mt-5 text-[1.75rem] leading-tight font-[380] tracking-[-0.015em]">No invitations here</h1>
          <p className="mt-2 text-[0.9375rem] text-muted-foreground">
            This Payslip runs without sign-in, so there is nothing to join: the console is open on this machine.
          </p>
          <div className="mt-6 border-t border-hairline pt-6">
            <Button asChild>
              <Link href="/console">Open the console</Link>
            </Button>
          </div>
        </Card>
      </main>
    );
  }
  if (!(await signedIn(await headers()))) {
    redirect(`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`);
  }
  return (
    <main id="main" className="mx-auto grid min-h-dvh max-w-[480px] content-center px-4 py-12">
      <InviteAccept token={token} />
    </main>
  );
}
