"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  Bookmark as BookmarkIcon,
  Building2,
  Home,
  KeyRound,
  Landmark,
  ListChecks,
  MailPlus,
  Plus,
  ScrollText,
  UsersRound,
} from "lucide-react";
import { useHealth } from "@/components/app/health-provider";
import { NetworkBadge } from "@/components/app/network-badge";
import { useAuth } from "@/components/auth/auth-provider";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Initials } from "@/components/ds/avatar";
import { AppShell, Bookmark, SidebarBrand, type NavItem, type ShellConfig } from "@/components/shell/app-shell";
import { SampleTag, useSampleCompany } from "@/components/shell/sample-tag";
import { Button } from "@/components/ui/button";
import { useResource } from "@/hooks/use-resource";
import { api, type Run } from "@/lib/api";
import { Usd, Zec } from "@/components/app/amount";
import { latestFillRate, runStateLabel, zatToCents } from "@/components/console/lib";
import { ConsoleSearch } from "@/components/console/search";
import { plural, runTitle } from "@/components/runs/run-meta";
import { companyMark, companyName } from "@/lib/company";
import { networkLabel } from "@/lib/format";
import { isCancelled, latestPeriodFirst } from "@/lib/payroll";
import { roleLabel } from "@/lib/roles";

/** The company console (today's payer pages): sidebar, Payroll | Books switch, treasury bookmark. */
export function ConsoleShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { network } = useHealth();
  const auth = useAuth();
  const Mark = companyMark();
  const sample = useSampleCompany();
  const wallet = useResource((s) => api.wallet(s), "shell-wallet");
  const runs = useResource((s) => api.runs(s), "shell-runs");
  // The bookmark is the latest pay period's run (cancelled ones are closed and skipped).
  const latest = runs.data ? latestPeriodFirst(runs.data.filter((r) => !isCancelled(r)))[0] : undefined;
  const open = runs.data?.filter((r) => !["paid", "failed", "cancelled"].includes(r.status)).length ?? 0;
  // With sign-in on, the organisation an admin named under Settings takes the brand's place;
  // otherwise the company from NEXT_PUBLIC_PAYSLIP_COMPANY_NAME (lib/company.ts).
  const org = auth.me?.membership?.org;
  // With sign-in on, the organisation's own pages: members for everyone to see who is in,
  // invitations and settings for admins, the audit log for admins and accountants.
  const orgNav: NavItem[] = auth.required
    ? [
        { href: "/console/members", label: "Members", icon: UsersRound },
        ...(auth.can("manage_org") ? [{ href: "/console/invitations", label: "Invitations", icon: MailPlus }] : []),
        ...(auth.can("view_audit") ? [{ href: "/console/audit", label: "Audit log", icon: ScrollText }] : []),
        ...(auth.can("manage_org") ? [{ href: "/console/settings", label: "Settings", icon: Building2 }] : []),
      ]
    : [];
  const config: ShellConfig = {
    // The employer, as a payroll product shows it; the chip is the network, the tag says the data is sample.
    brand: (
      <SidebarBrand
        mark={
          org?.logo_url ? (
            // The organisation's own mark, from the address an admin set under Settings.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={org.logo_url} alt="" className="size-[22px] shrink-0 rounded-[5px] object-cover" />
          ) : (
            <Mark className="size-[22px]" />
          )
        }
        name={org?.name || companyName()}
        chip={network ? networkLabel(network) : undefined}
        sub={sample ? <SampleTag /> : undefined}
      />
    ),
    segments: [
      { label: "Payroll", href: "/console", active: !pathname.startsWith("/books") },
      { label: "Books", href: "/books", active: pathname.startsWith("/books") },
    ],
    nav: [
      [
        { href: "/console", label: "Home", icon: Home, exact: true },
        { href: "/console/runs", label: "Payroll runs", icon: ListChecks, badge: open > 0 ? open : undefined },
      ],
      [
        { href: "/console/people", label: "People", icon: UsersRound },
        ...(auth.can("view_keys") ? [{ href: "/console/access", label: "Payslip access", icon: KeyRound }] : []),
        { href: "/console/treasury", label: "Treasury", icon: Landmark },
      ],
      ...(orgNav.length > 0 ? [orgNav] : []),
    ],
    bookmarks: (
      <div className="grid gap-0.5">
        <p className="px-2 pt-1 pb-1 text-[0.8125rem] text-muted-foreground">Bookmarks</p>
        <Bookmark
          href="/console/treasury"
          icon={BookmarkIcon}
          label="Treasury"
          detail={
            wallet.data ? (
              <TreasuryDetail zat={wallet.data.treasury.total_zat} runs={runs.data ?? []} />
            ) : wallet.error ? (
              "Unavailable"
            ) : (
              "Loading"
            )
          }
        />
        {latest ? (
          <Bookmark
            href={`/console/runs/${latest.id}`}
            icon={BookmarkIcon}
            label={`${runTitle(latest)} payroll`}
            detail={`${runStateLabel(latest)}, ${plural(latest.lines.length, "person", "people")}`}
          />
        ) : null}
      </div>
    ),
    footer: auth.required && auth.me ? <SignedInAs me={auth.me} /> : undefined,
    topLeft: (
      <>
        <NetworkBadge className="hidden sm:inline-flex" />
        <ConsoleSearch />
      </>
    ),
    menuAction: auth.can("manage_runs") ? (
      <Button asChild size="sm" className="w-full">
        <Link href="/console/runs/new">
          <Plus aria-hidden="true" />
          Run payroll
        </Link>
      </Button>
    ) : undefined,
  };
  return <AppShell config={config}>{children}</AppShell>;
}

/** Who is signed in, at the bottom of the sidebar, with a way out. */
function SignedInAs({ me }: { me: NonNullable<ReturnType<typeof useAuth>["me"]> }) {
  const name = me.user.name || me.user.email;
  return (
    <div className="grid gap-1.5 border-t border-hairline px-1 pt-3" data-testid="signed-in-as">
      <div className="flex items-center gap-2.5 px-1">
        {me.user.picture_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={me.user.picture_url} alt="" className="size-7 shrink-0 rounded-full object-cover" />
        ) : (
          <Initials name={name} />
        )}
        <span className="grid min-w-0">
          <span className="truncate text-[0.875rem] text-foreground">{name}</span>
          <span className="truncate text-[0.8125rem] text-muted-foreground">
            {me.membership ? roleLabel(me.membership.role) : "Not a member"}
          </span>
        </span>
      </div>
      <SignOutButton className="justify-start" />
    </div>
  );
}

/**
 * The treasury under its bookmark. Mainnet: dollars at the latest fill rate (a real price at the
 * time), as Mercury's bookmarks show balances. Testnet: the coin itself, because the only rate
 * there is simulated and is not a price.
 */
function TreasuryDetail({ zat, runs }: { zat: number; runs: Run[] }) {
  const { network } = useHealth();
  const rate = network === "mainnet" ? latestFillRate(runs) : null;
  if (rate) return <Usd cents={zatToCents(zat, rate)} />;
  return <Zec zat={zat} short />;
}
