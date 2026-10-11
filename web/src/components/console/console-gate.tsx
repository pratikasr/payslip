"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { BookOpen, FileCheck2, UserRound } from "lucide-react";
import { useHealth } from "@/components/app/health-provider";
import { SlipHead } from "@/components/app/logo";
import { useAuth } from "@/components/auth/auth-provider";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Card } from "@/components/ds/card";
import { Button } from "@/components/ui/button";
import { TYPE } from "@/components/ds/type";
import { cn } from "cn";

/**
 * Decides what /console can be on this deployment. A statements-only service (PAYSLIP_MODE=
 * statements) has no wallet, so instead of a console whose every action fails it says what this
 * deployment does and links there. Until the service has said which mode it runs in, nothing of
 * the console shows (the layout reads the mode on the server, so this is rare: the service was
 * unreachable from the server but not from the browser).
 *
 * With sign-in on, a person who signed in but was never invited sees who they are and what to
 * do, never an empty console (the service refuses every call for them anyway).
 */
export function ConsoleGate({ children }: { children: ReactNode }) {
  const { mode, loading } = useHealth();
  const auth = useAuth();
  if (auth.required && auth.me && !auth.me.membership) return <NotAMember email={auth.me.user.email} />;
  if (mode === "statements") return <StatementsOnly />;
  if (mode === undefined && loading) {
    return (
      <div
        role="status"
        className="grid min-h-[60dvh] place-items-center px-4 font-type text-[0.8125rem] text-muted-foreground"
      >
        Connecting to the Payslip service
      </div>
    );
  }
  return children;
}

function NotAMember({ email }: { email: string }) {
  return (
    <main id="main" className="mx-auto grid min-h-dvh max-w-[560px] content-center px-4 py-12">
      <Card className="sheet-shadow px-6 py-7 sm:px-8">
        <SlipHead label="Membership" />
        <h1 className={cn(TYPE.title, "mt-5")}>You are not a member yet</h1>
        <p className="mt-2 text-[0.9375rem] text-muted-foreground">
          You are signed in as <span className="text-foreground">{email}</span>, but this organisation has not invited
          that address. Ask an admin for an invitation link and open it while signed in with this email, or sign out and
          use the address they invited.
        </p>
        <div className="mt-6 flex flex-wrap gap-2 border-t border-ink pt-6">
          <SignOutButton variant="secondary" size="default" />
          <Button asChild variant="outline">
            <Link href="/">About Payslip</Link>
          </Button>
        </div>
      </Card>
    </main>
  );
}

function StatementsOnly() {
  return (
    <main id="main" className="mx-auto grid min-h-[calc(100dvh-3rem)] max-w-[640px] content-center px-4 py-12">
      <Card className="sheet-shadow px-6 py-7 sm:px-8">
        <SlipHead label="Statements only" />
        <h1 className={cn(TYPE.title, "mt-5")}>This Payslip only reads statements</h1>
        <p className="mt-2 text-[0.9375rem] text-muted-foreground">
          It runs without a wallet, so there is no company console here: it cannot add people or run payroll. It reads
          payslips and books from viewing keys, and checks payment proofs against the Zcash chain.
        </p>
        <div className="mt-6 grid gap-4 border-t border-ink pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-type text-[0.9375rem] font-bold">Import the judge kit</p>
              <p className="text-[0.8125rem] text-muted-foreground">
                In Books, choose Import key file and pick docs/judge/judge-kit-testnet.json from the repository.
              </p>
            </div>
            <Button asChild>
              <Link href="/books">
                <BookOpen aria-hidden="true" />
                Open Books
              </Link>
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 font-type text-[0.9375rem] font-bold">
              Read one contractor&apos;s payslips with their key
            </p>
            <Button asChild variant="secondary">
              <Link href="/portal">
                <UserRound aria-hidden="true" />
                Contractor portal
              </Link>
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="min-w-0 font-type text-[0.9375rem] font-bold">Check a payslip proof someone shared</p>
            <Button asChild variant="secondary">
              <Link href="/verify">
                <FileCheck2 aria-hidden="true" />
                Check a proof
              </Link>
            </Button>
          </div>
        </div>
      </Card>
    </main>
  );
}
