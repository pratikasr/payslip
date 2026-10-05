"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ListChecks, ReceiptText, Search, UserRound } from "lucide-react";
import { Usd } from "@/components/app/amount";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useResource } from "@/hooks/use-resource";
import { api, type Contractor, type Run } from "@/lib/api";
import { latestPeriodFirst } from "@/lib/payroll";
import { runTag, runTitle } from "@/components/runs/run-meta";

interface Hit {
  key: string;
  href: string;
  icon: typeof Search;
  title: string;
  detail: React.ReactNode;
}

const PER_GROUP = 6;

/** People by name or email, runs by period or status, payments by invoice, person or transaction id. */
function search(query: string, people: Contractor[], runs: Run[]): { label: string; hits: Hit[] }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const has = (v: string | null | undefined) => !!v && v.toLowerCase().includes(q);
  const peopleHits: Hit[] = people
    .filter((c) => has(c.name) || has(c.email))
    .slice(0, PER_GROUP)
    .map((c) => ({
      key: `p-${c.id}`,
      href: `/console/people?person=${c.id}`,
      icon: UserRound,
      title: c.name,
      detail: c.email ?? "Contractor",
    }));
  const sorted = latestPeriodFirst(runs);
  const runHits: Hit[] = sorted
    .filter((r) => has(`${runTitle(r)} payroll`) || has(r.period_label) || has(runTag(r).label) || r.id.startsWith(q))
    .slice(0, PER_GROUP)
    .map((r) => ({
      key: `r-${r.id}`,
      href: `/console/runs/${r.id}`,
      icon: ListChecks,
      title: `${runTitle(r)} payroll`,
      detail: (
        <>
          {runTag(r).label} · <Usd cents={r.total_usd_cents} />
        </>
      ),
    }));
  // A transaction id is matched from its start, so a pasted prefix finds the payment.
  const paymentHits: Hit[] = sorted
    .flatMap((r) =>
      r.lines
        .filter((l) => has(l.invoice_ref) || (q.length >= 6 && !!l.txid?.startsWith(q)))
        .map((l) => ({
          key: `l-${l.id}`,
          href: `/console/runs/${r.id}`,
          icon: ReceiptText,
          title: `${l.invoice_ref || "No invoice"} · ${l.contractor_name}`,
          detail: (
            <>
              {runTitle(r)} · <Usd cents={l.amount_usd_cents} />
            </>
          ),
        })),
    )
    .slice(0, PER_GROUP);
  return [
    { label: "People", hits: peopleHits },
    { label: "Payroll runs", hits: runHits },
    { label: "Payments", hits: paymentHits },
  ].filter((g) => g.hits.length > 0);
}

/**
 * Mercury's "Search for anything", for the company console: one field for people, payroll runs,
 * invoice references and transaction ids, from the data the console already reads. Opens from the
 * top bar or with Ctrl+K (Command+K on a Mac). Enter opens the first result.
 */
export function ConsoleSearch() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey) && !e.altKey) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="hidden w-64 justify-start gap-2 rounded-full border-border px-3 text-muted-foreground md:inline-flex lg:w-72"
      >
        <Search aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-left">Search people, runs, invoices</span>
        <kbd className="rounded border px-1 font-sans text-[11px] text-muted-foreground" aria-hidden="true">
          Ctrl K
        </kbd>
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="md:hidden"
        aria-label="Search people, runs and invoices"
        onClick={() => setOpen(true)}
      >
        <Search aria-hidden="true" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-[12vh] translate-y-0 gap-0 p-0 sm:max-w-[560px]" showCloseButton={false}>
          {open ? <SearchBody onDone={() => setOpen(false)} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function SearchBody({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const people = useResource((s) => api.contractors(s), "search-people");
  const runs = useResource((s) => api.runs(s), "search-runs");
  const groups = useMemo(() => search(query, people.data ?? [], runs.data ?? []), [query, people.data, runs.data]);
  const count = groups.reduce((n, g) => n + g.hits.length, 0);
  const first = groups[0]?.hits[0];
  const loading = !people.data || !runs.data;
  return (
    <div>
      <DialogTitle className="sr-only">Search</DialogTitle>
      <DialogDescription className="sr-only">
        Find people, payroll runs, invoice references and transaction ids. Enter opens the first result.
      </DialogDescription>
      <div className="flex items-center gap-2.5 border-b border-hairline px-4">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          autoFocus
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && first) {
              e.preventDefault();
              onDone();
              router.push(first.href);
            }
          }}
          placeholder="Search people, runs, invoices or a transaction id"
          aria-label="Search"
          aria-describedby="search-count"
          className="h-12 min-w-0 flex-1 bg-transparent text-[0.9375rem] outline-none placeholder:text-muted-foreground"
        />
      </div>
      <p id="search-count" className="sr-only" aria-live="polite">
        {query.trim() ? `${count} ${count === 1 ? "result" : "results"}` : ""}
      </p>
      <div className="max-h-[min(60dvh,420px)] overflow-y-auto px-2 py-2">
        {!query.trim() ? (
          <p className="px-2 py-3 text-[0.8125rem] text-muted-foreground">
            Type a name, a month such as Sep 2026, an invoice reference or the start of a transaction id.
          </p>
        ) : loading ? (
          <p className="px-2 py-3 text-[0.8125rem] text-muted-foreground">Loading</p>
        ) : count === 0 ? (
          <p className="px-2 py-3 text-[0.8125rem] text-muted-foreground">
            Nothing matches &ldquo;{query.trim()}&rdquo;.
          </p>
        ) : (
          groups.map((g) => (
            <section key={g.label} aria-label={g.label} className="py-1">
              <h2 className="px-2 pt-1 pb-1.5 text-[0.8125rem] text-muted-foreground">{g.label}</h2>
              <ul>
                {g.hits.map((h) => (
                  <li key={h.key}>
                    <Link
                      href={h.href}
                      onClick={onDone}
                      className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted focus-visible:bg-muted"
                    >
                      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-chip text-muted-foreground">
                        <h.icon className="size-3.5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.9375rem]">{h.title}</span>
                        <span className="block truncate text-[0.8125rem] text-muted-foreground">{h.detail}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
