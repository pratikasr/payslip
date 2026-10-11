"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useHealth } from "@/components/app/health-provider";
import { SlipHead } from "@/components/app/logo";
import { useAuth } from "@/components/auth/auth-provider";
import { Sheet } from "@/components/ds/paper";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { roleLabel } from "@/lib/roles";
import { TYPE } from "@/components/ds/type";
import { cn } from "cn";
import { TreasuryKeyForm } from "./key-form";

/**
 * What the console is while the service has no treasury key (`treasury: "no_key"` in health):
 * one sheet on the desk. An admin creates the key here; anyone else is told who can. Nothing
 * of the console shows until the key exists, because without it there is no treasury to fund,
 * no account for a contractor and no payment to make.
 */
export function TreasuryOnboarding() {
  const auth = useAuth();
  const router = useRouter();
  const { setTreasury } = useHealth();
  const org = auth.me?.membership?.org.name;
  const admin = auth.can("manage_treasury_key");
  return (
    <main id="main" className="mx-auto grid min-h-[calc(100dvh-3rem)] max-w-[800px] content-start px-2.5 py-8 sm:px-6">
      <Sheet className="px-0 py-7" data-testid="treasury-onboarding">
        <div className="px-4 sm:px-8">
          <SlipHead label="Treasury key" />
          {admin ? (
            <>
              <h1 className={cn(TYPE.title, "mt-5")}>Create your treasury key</h1>
              <p className="mt-2 max-w-[60ch] text-[0.9375rem] text-muted-foreground">
                {org ? `${org} pays` : "Payroll is paid"} from one shielded Zcash treasury, and every contractor&apos;s
                account is derived from the same key. The key is made in this browser, encrypted with a passphrase only
                you know, and stored on the service as that encrypted file. Nobody at Payslip can spend it.
              </p>
              <div className="mt-6">
                <TreasuryKeyForm
                  intent="create"
                  onSeal={(ciphertext, passphrase) => api.createTreasuryKey({ ciphertext, passphrase })}
                  onDone={(key) => {
                    // The service answered the key's state; health confirms it on the next read.
                    setTreasury(key.state);
                    router.refresh();
                  }}
                />
              </div>
            </>
          ) : (
            <>
              <h1 className={cn(TYPE.title, "mt-5")}>No treasury key yet</h1>
              <p className="mt-2 max-w-[60ch] text-[0.9375rem] text-muted-foreground">
                {org ? `${org} has` : "This Payslip has"} no treasury key yet, so there is nothing to fund or pay from.
                An admin creates it from the console; you are signed in as{" "}
                {roleLabel(auth.role).toLowerCase() || "a member"}.
              </p>
              <div className="mt-6 flex flex-wrap gap-2 border-t border-ink pt-6">
                <Button asChild variant="secondary">
                  <Link href="/console/members">See the members</Link>
                </Button>
              </div>
            </>
          )}
        </div>
      </Sheet>
    </main>
  );
}
