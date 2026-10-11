import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogoMark } from "@/components/app/logo";
import { SignInCard } from "@/components/auth/sign-in-card";
import { Card } from "@/components/ds/card";
import { Button } from "@/components/ui/button";
import { authRequired, googleConfigured, testLoginEnabled, workspaceDomain } from "@/lib/auth-config";
import { signedIn } from "@/lib/service-session";
import { TYPE } from "@/components/ds/type";
import { cn } from "cn";

export const metadata: Metadata = { title: "Sign in" };

/** Only paths on this site are followed after sign-in; anything else goes to the console. */
function safeNext(raw: string | string[] | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && v.startsWith("/") && !v.startsWith("//") ? v : "/console";
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; error?: string | string[] }>;
}) {
  const params = await searchParams;
  const next = safeNext(params.next);
  if (!authRequired()) return <SignInOff />;
  if (await signedIn(await headers())) redirect(next);
  const error = Array.isArray(params.error) ? params.error[0] : params.error;
  return (
    <main id="main" className="mx-auto grid min-h-dvh max-w-[440px] content-center px-4 py-12">
      <SignInCard
        next={next}
        google={googleConfigured()}
        testLogin={testLoginEnabled()}
        domain={workspaceDomain()}
        error={error ?? null}
      />
    </main>
  );
}

function SignInOff() {
  return (
    <main id="main" className="mx-auto grid min-h-dvh max-w-[440px] content-center px-4 py-12">
      <Card className="px-6 py-7 sm:px-8">
        <LogoMark className="size-[30px]" />
        <h1 className={cn(TYPE.title, "mt-5")}>No sign-in here</h1>
        <p className="mt-2 text-[0.9375rem] text-muted-foreground">
          This Payslip runs without sign-in: the console is open on this machine. To require sign-in, set
          PAYSLIP_AUTH=required on the web app and the service.
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
