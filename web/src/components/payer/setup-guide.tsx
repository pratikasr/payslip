"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { ArrowUpRight, Check, Info, RefreshCw, X } from "lucide-react";
import { Zec } from "@/components/app/amount";
import { CopyButton } from "@/components/app/copy-button";
import { Button } from "@/components/ui/button";
import type { Contractor, Network, Run, Wallet } from "@/lib/api";
import { formatCount, formatPeriodLabel } from "@/lib/format";
import { cn } from "cn";

/*
  First-run setup for a payer. Every step's state comes from the service
  (GET /api/wallet, /api/contractors, /api/runs); nothing is ticked by hand.
  Hiding the guide is remembered in this browser (localStorage).
*/

/** Also read by the boot script in src/lib/presenter.ts, which hides a dismissed guide before first paint. */
export const DISMISS_KEY = "payslip.setup-guide.dismissed";
const DISMISS_EVENT = "payslip:setup-guide";
/** Verified 5 Oct 2026 (docs/TECH-DECISIONS.md, Verified facts): 0.125 TAZ per IP address per day. */
export const TESTNET_FAUCET_URL = "https://faucet.testnet.valargroup.dev/";

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(DISMISS_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(DISMISS_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Whether the payer hid the guide. `null` until the browser value is known. */
export function useGuideDismissed(): [boolean | null, (hidden: boolean) => void] {
  const value = useSyncExternalStore<boolean | null>(subscribe, readDismissed, () => null);
  const set = (hidden: boolean) => {
    try {
      if (hidden) window.localStorage.setItem(DISMISS_KEY, "1");
      else window.localStorage.removeItem(DISMISS_KEY);
    } catch {
      // Blocked storage: the choice lasts until the page reloads.
    }
    if (hidden) document.documentElement.setAttribute("data-guide-hidden", "");
    else document.documentElement.removeAttribute("data-guide-hidden");
    window.dispatchEvent(new Event(DISMISS_EVENT));
  };
  return [value, set];
}

interface Step {
  id: string;
  title: string;
  done: boolean;
  /** One line from the API state, shown when done. */
  status: React.ReactNode;
  body: React.ReactNode;
  action?: { href: string; label: string; external?: boolean };
  extra?: React.ReactNode;
  info?: boolean;
}

const FUNDED_OR_LATER = new Set(["funded", "swapping", "swapped", "allocating", "paying", "paid"]);

export function setupSteps({
  wallet,
  contractors,
  runs,
  network,
}: {
  wallet: Wallet;
  contractors: Contractor[];
  runs: Run[];
  network: Network;
}): Step[] {
  const shared = contractors.filter((c) => c.fvk_shared_at).length;
  const indexes = contractors.map((c) => c.account_index).sort((a, b) => a - b);
  const paid = runs.find((r) => r.status === "paid");
  const unfinished = runs.find((r) => r.status !== "paid");
  const t = wallet.treasury;
  const fundedBefore = runs.some((r) => FUNDED_OR_LATER.has(r.status) || r.status === "failed");

  const fund: Step =
    network === "mainnet"
      ? {
          id: "fund",
          title: "Fund the treasury",
          done: true,
          info: true,
          status: "Mainnet: funded per run in USDC, nothing to do now",
          body: "On mainnet each run is funded on its own Fund step: you send USDC from your wallet and NEAR Intents delivers ZEC into the treasury. No balance needs to wait here in advance.",
        }
      : {
          id: "fund",
          title: "Fund the treasury with testnet coins",
          done: t.spendable_zat > 0 || fundedBefore,
          status: (
            <>
              <Zec zat={t.total_zat} /> in the treasury
            </>
          ),
          body:
            t.pending_zat > 0 && t.spendable_zat === 0 ? (
              <>
                <Zec zat={t.pending_zat} /> is on its way and becomes spendable after one confirmation. Check for funds
                in a minute.
              </>
            ) : (
              "On testnet the fixed-rate venue draws each run's coins from the treasury. Paste the treasury address into the faucet, wait for one confirmation, then check for funds."
            ),
          action: { href: TESTNET_FAUCET_URL, label: "Open the testnet faucet", external: true },
        };

  return [
    fund,
    {
      id: "contractors",
      title: "Add your contractors",
      done: contractors.length > 0,
      status:
        contractors.length === 1
          ? `1 contractor, account ${indexes[0]}`
          : `${formatCount(contractors.length)} contractors, accounts ${indexes[0]} to ${indexes[indexes.length - 1]}`,
      body: "Name, unified address and how they want to be paid. Each contractor gets a dedicated account, so their viewing key shows their pay and nobody else's.",
      action: { href: "/app/payer/contractors?add=1", label: "Add a contractor" },
    },
    {
      id: "keys",
      title: "Share viewing keys",
      done: contractors.length > 0 && shared === contractors.length,
      status: `${formatCount(shared)} of ${formatCount(contractors.length)} shared`,
      body:
        contractors.length === 0
          ? "Once contractors are added, each gets the viewing key for their account so they can read their own statement."
          : `${formatCount(shared)} of ${formatCount(contractors.length)} contractors have their key. Open Share viewing key on each row, send the key or let them scan the QR, then mark it as shared. Export every key for your accountant from the same page.`,
      action: { href: "/app/payer/contractors", label: "Share viewing keys" },
    },
    {
      id: "run",
      title: "Create your first run",
      done: runs.length > 0,
      status: `${formatCount(runs.length)} ${runs.length === 1 ? "run" : "runs"}, latest for ${formatPeriodLabel(runs[0]?.period_label)}`,
      body: "Pick the period, enter each contractor's amount in USD and an invoice reference. Nothing moves until you fund and execute.",
      action: { href: "/app/payer/runs/new", label: "Create a run" },
    },
    {
      id: "execute",
      title: "Fund and execute it",
      done: !!paid,
      status: paid
        ? `${formatPeriodLabel(paid.period_label)} paid, ${paid.lines.filter((l) => l.status === "confirmed").length} payments confirmed`
        : "",
      body: unfinished
        ? `The run for ${formatPeriodLabel(unfinished.period_label)} is waiting. Fund it, then execute: one shielded payment per contractor, each with an encrypted memo.`
        : "Fund the run, then execute it: one shielded payment per contractor, each with an encrypted memo.",
      action: unfinished
        ? {
            href: `/app/payer/runs/${unfinished.id}`,
            label: `Open the ${formatPeriodLabel(unfinished.period_label)} run`,
          }
        : { href: "/app/payer/runs/new", label: "Create a run" },
    },
  ];
}

export function SetupGuide({
  wallet,
  contractors,
  runs,
  network,
  onSync,
  syncing,
  onHide,
}: {
  wallet: Wallet;
  contractors: Contractor[];
  runs: Run[];
  network: Network;
  onSync: () => void;
  syncing: boolean;
  onHide: () => void;
}) {
  const steps = setupSteps({ wallet, contractors, runs, network });
  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.findIndex((s) => !s.done);

  return (
    <section aria-labelledby="setup-title" className="rounded-lg border bg-card" data-setup-guide="">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4">
        <div className="min-w-0 space-y-0.5">
          <h2 id="setup-title" className="text-base font-semibold">
            Set up payroll
          </h2>
          <p className="text-sm text-muted-foreground">
            <span className="num font-medium text-foreground">{doneCount}</span> of{" "}
            <span className="num">{steps.length}</span> done. Each step ticks itself when the service sees it happen.
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onHide} data-print="hide">
          <X aria-hidden="true" />
          Hide guide
        </Button>
      </div>
      <div
        className="mx-4 mt-3 mb-1 grid gap-[2px]"
        style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={doneCount}
        aria-valuetext={`${doneCount} of ${steps.length} steps done`}
      >
        {steps.map((s, i) => (
          <span
            key={s.id}
            className={cn(
              "h-1.5 bg-muted transition-colors duration-500 first:rounded-l-full last:rounded-r-full",
              s.done && "bg-success",
              i === next && "bg-primary",
            )}
          />
        ))}
      </div>
      <ol className="mt-2 divide-y border-t">
        {steps.map((s, i) => {
          const current = i === next;
          return (
            <li key={s.id} className={cn("px-4 py-3", current && "bg-warning-bg/40")}>
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className={cn(
                    "num mt-px inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                    s.done && !s.info && "border-transparent bg-success-bg text-success",
                    s.info && "border-transparent bg-info-bg text-info",
                    current && "border-primary-edge bg-card",
                    !s.done && !current && "text-muted-foreground",
                  )}
                >
                  {s.info ? <Info className="size-3.5" /> : s.done ? <Check className="size-3.5" /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-x-4 gap-y-0.5 sm:flex-row sm:items-baseline sm:justify-between">
                    <p className={cn("font-medium", !s.done && !current && "text-muted-foreground")}>
                      {s.title}
                      <span className="sr-only">
                        {s.done ? " (done)" : current ? " (next step)" : " (not started)"}
                      </span>
                    </p>
                    {s.done ? <p className="text-sm text-muted-foreground">{s.status}</p> : null}
                  </div>
                  {current ? (
                    <div className="mt-2 space-y-3">
                      <p className="max-w-prose text-sm text-muted-foreground">{s.body}</p>
                      {s.id === "fund" && network === "testnet" ? (
                        <TreasuryAddress address={wallet.treasury.unified_address} />
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        {s.action ? (
                          <Button asChild size="sm">
                            {s.action.external ? (
                              <a href={s.action.href} target="_blank" rel="noreferrer">
                                {s.action.label}
                                <ArrowUpRight aria-hidden="true" />
                                <span className="sr-only"> (opens in a new tab)</span>
                              </a>
                            ) : (
                              <Link href={s.action.href}>{s.action.label}</Link>
                            )}
                          </Button>
                        ) : null}
                        {s.id === "fund" && network === "testnet" ? (
                          <Button variant="outline" size="sm" onClick={onSync} disabled={syncing}>
                            <RefreshCw className={cn(syncing && "animate-spin")} aria-hidden="true" />
                            {syncing ? "Checking" : "Check for funds"}
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function TreasuryAddress({ address }: { address: string }) {
  return (
    <div className="max-w-2xl rounded-md border bg-background p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">Treasury address (account 0)</span>
        <CopyButton value={address} label="treasury address" size="sm">
          Copy address
        </CopyButton>
      </div>
      <code className="block font-mono text-xs leading-relaxed break-all">{address}</code>
    </div>
  );
}
