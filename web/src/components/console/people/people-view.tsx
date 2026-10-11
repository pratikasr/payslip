"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { KeyRound, Plus, Search, UsersRound } from "lucide-react";
import { Usd } from "@/components/app/amount";
import { useCoinUnit } from "@/components/app/health-provider";
import { Initials } from "@/components/ds/avatar";
import { PageTitle } from "@/components/ds/page";
import { Tag } from "@/components/ds/tag";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useResource } from "@/hooks/use-resource";
import { api, type Contractor, type Run } from "@/lib/api";
import { formatCount, formatShortDate } from "@/lib/format";
import { lastPaidByContractor, settlementLabel } from "@/components/console/lib";
import { ContractorDialog } from "@/components/console/people/contractor-dialog";
import { ArchiveDialog, PersonDrawer } from "@/components/console/people/person-drawer";
import { Problem } from "@/components/runs/problem";

/**
 * Set or clear one search parameter without a server round trip (Next syncs useSearchParams).
 * `push` adds a history entry, so the browser's Back undoes it (closing a drawer it opened).
 */
function setParam(pathname: string, key: string, value: string | null, push = false) {
  const params = new URLSearchParams(window.location.search);
  if (value === null) params.delete(key);
  else params.set(key, value);
  const q = params.toString();
  const url = q ? `${pathname}?${q}` : pathname;
  if (push) window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

export function PeopleView({ initial }: { initial: { contractors?: Contractor[]; runs?: Run[] } }) {
  const coin = useCoinUnit();
  const contractors = useResource((s) => api.contractors(s), "people-contractors", initial.contractors);
  const runs = useResource((s) => api.runs(s), "people-runs", initial.runs);
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedId = params.get("person");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Contractor | undefined>(undefined);
  const [archiving, setArchiving] = useState<Contractor | null>(null);

  // ?add=1 (from Home and the setup checklist) opens the add dialog once, then leaves the URL.
  useEffect(() => {
    if (params.get("add") === "1") {
      setAdding(true);
      setParam(pathname, "add", null);
    }
  }, [params, pathname]);

  const list = useMemo(
    () => (contractors.data ?? []).slice().sort((a, b) => a.account_index - b.account_index),
    [contractors.data],
  );
  const last = useMemo(() => lastPaidByContractor(runs.data ?? []), [runs.data]);
  const q = query.trim().toLowerCase();
  const shown = q
    ? list.filter((c) =>
        [c.name, c.email ?? "", c.unified_address, settlementLabel(c, coin)].some((v) => v.toLowerCase().includes(q)),
      )
    : list;
  const selected = selectedId ? list.find((c) => c.id === selectedId) : undefined;

  // Opening a drawer adds a history entry, so Back closes it; closing it any other way steps
  // back over that entry instead of leaving it behind. A drawer opened from a link has no entry
  // of its own, so closing it only drops the parameter.
  const pushed = useRef(false);
  const removed = useRef(new Set<string>());
  const open = (c: Contractor) => {
    setParam(pathname, "person", c.id, !selectedId);
    if (!selectedId) pushed.current = true;
  };
  const close = () => {
    if (pushed.current) {
      pushed.current = false;
      window.history.back();
    } else {
      setParam(pathname, "person", null);
    }
  };
  useEffect(() => {
    if (!selectedId) pushed.current = false;
  }, [selectedId]);

  // A link to someone who was archived (or never existed) says so instead of showing the plain list.
  useEffect(() => {
    if (!selectedId || !contractors.data || selected || removed.current.has(selectedId)) return;
    toast.info("This person was archived or does not exist.", {
      description: "Their past payments stay on the run pages and in the books.",
    });
    setParam(pathname, "person", null);
  }, [selectedId, contractors.data, selected, pathname]);
  const upsert = (c: Contractor) =>
    contractors.setData((prev) => {
      const rest = (prev ?? []).filter((p) => p.id !== c.id);
      return [...rest, c];
    });

  return (
    <>
      <PageTitle
        title="People"
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            Add contractor
          </Button>
        }
      />

      {contractors.error && !contractors.data ? (
        <Problem error={contractors.error} title="Could not load your people" onRetry={contractors.reload} />
      ) : !contractors.data ? (
        <PeopleSkeleton />
      ) : list.length === 0 ? (
        <div className="flex flex-col items-start gap-4 border-t border-hairline py-12 sm:items-center sm:text-center">
          <span className="grid size-11 place-items-center rounded-full bg-chip text-strong">
            <UsersRound className="size-5" aria-hidden="true" />
          </span>
          <div className="max-w-md space-y-1.5">
            <h2 className="text-[1.1875rem] font-normal tracking-[-0.01em]">No contractors yet</h2>
            <p className="text-[0.9375rem] text-muted-foreground">
              Each person gets a private account and a key to their own payslips.
            </p>
          </div>
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden="true" />
            Add your first contractor
          </Button>
        </div>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search people"
                aria-label="Search people"
                className="h-9 rounded-full border-border pl-9"
              />
            </div>
            <span className="ml-auto text-[0.8125rem] text-muted-foreground" aria-live="polite">
              {q ? `${formatCount(shown.length)} of ${formatCount(list.length)}` : `${formatCount(list.length)} people`}
            </span>
          </div>

          {/* Fixed layout: a long name truncates in its column instead of widening the page. */}
          <table className="w-full table-fixed border-collapse text-[0.9375rem]">
            <caption className="sr-only">Contractors. Select a person to see their details and payments.</caption>
            <thead>
              <tr className="border-b border-hairline text-left text-[0.8125rem] text-muted-foreground">
                <th scope="col" className="py-3 pr-3 font-normal">
                  Name
                </th>
                <th scope="col" className="hidden w-[9.5rem] py-3 pr-3 font-normal lg:table-cell">
                  Payout
                </th>
                <th scope="col" className="hidden w-[8rem] py-3 pr-3 font-normal md:table-cell">
                  Payslip access
                </th>
                <th scope="col" className="hidden w-[8.5rem] py-3 pr-3 text-right font-normal xl:table-cell">
                  Total paid
                </th>
                <th scope="col" className="w-[8rem] py-3 text-right font-normal sm:w-[9.5rem]">
                  Last paid
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr className="border-b border-hairline">
                  <td colSpan={5} className="h-[52px] text-[0.8125rem] text-muted-foreground">
                    Nobody matches &ldquo;{query.trim()}&rdquo;.
                  </td>
                </tr>
              ) : (
                shown.map((c) => {
                  const lp = last.get(c.id);
                  const active = c.id === selectedId;
                  return (
                    <tr
                      key={c.id}
                      onClick={() => open(c)}
                      data-state={active ? "selected" : undefined}
                      className="group/row cursor-pointer border-b border-hairline transition-colors hover:bg-muted/60 data-[state=selected]:bg-muted"
                    >
                      <td className="h-[60px] w-full max-w-0 py-2 pr-3">
                        <span className="flex min-w-0 items-center gap-3">
                          <Initials name={c.name} />
                          <span className="min-w-0 flex-1">
                            <button
                              type="button"
                              data-person-open={c.id}
                              aria-haspopup="dialog"
                              className="block max-w-full truncate rounded-sm text-left"
                              title={c.name}
                            >
                              {c.name}
                            </button>
                            <span
                              className="block truncate text-[0.8125rem] text-muted-foreground"
                              title={c.email ?? undefined}
                            >
                              <span className="lg:hidden">{settlementLabel(c, coin)}</span>
                              {c.email ? (
                                <>
                                  <span className="lg:hidden"> · </span>
                                  {c.email}
                                </>
                              ) : null}
                            </span>
                          </span>
                          {/* Mercury's row actions: shown on hover or focus, always reachable by keyboard. */}
                          <span className="hidden shrink-0 opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 sm:inline-flex pointer-coarse:opacity-100">
                            <Button
                              asChild
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <Link
                                href={`/console/access#person-${c.id}`}
                                aria-label={`Share payslips, ${c.name}`}
                                title="Share payslips"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <KeyRound aria-hidden="true" />
                              </Link>
                            </Button>
                          </span>
                        </span>
                      </td>
                      <td className="hidden truncate pr-3 text-strong lg:table-cell">{settlementLabel(c, coin)}</td>
                      <td className="hidden pr-3 md:table-cell">
                        {c.fvk_shared_at ? (
                          <span className="inline-flex items-center gap-2 whitespace-nowrap">
                            <Tag>Shared</Tag>
                            <span className="text-[0.8125rem] text-muted-foreground">
                              {formatShortDate(c.fvk_shared_at)}
                            </span>
                          </span>
                        ) : (
                          <span className="text-[0.8125rem] text-muted-foreground">Not shared</span>
                        )}
                      </td>
                      <td className="hidden pr-3 text-right xl:table-cell">
                        {lp ? (
                          <Usd cents={lp.totalCents} />
                        ) : (
                          <span className="text-[0.8125rem] text-muted-foreground">None</span>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {lp ? (
                          <>
                            <Usd cents={lp.cents} className="block" />
                            <span className="block truncate text-[0.8125rem] text-muted-foreground" title={lp.period}>
                              {lp.period} · {formatShortDate(lp.date)}
                            </span>
                          </>
                        ) : (
                          <span className="text-[0.8125rem] text-muted-foreground">Never</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </>
      )}

      <PersonDrawer
        contractor={selected}
        runs={runs.data ?? []}
        onClose={close}
        onEdit={(c) => setEditing(c)}
        onArchive={(c) => setArchiving(c)}
        onSaved={upsert}
      />
      <ContractorDialog
        open={adding || !!editing}
        contractor={editing}
        onOpenChange={(o) => {
          if (!o) {
            setAdding(false);
            setEditing(undefined);
          }
        }}
        onSaved={(c) => {
          upsert(c);
          if (!editing) open(c);
        }}
      />
      <ArchiveDialog
        contractor={archiving}
        runs={runs.data ?? []}
        onClose={() => setArchiving(null)}
        onArchived={(id) => {
          removed.current.add(id);
          contractors.setData((prev) => (prev ?? []).filter((c) => c.id !== id));
          close();
        }}
      />
    </>
  );
}

function PeopleSkeleton() {
  return (
    <div role="status" aria-label="Loading people" className="space-y-3 pt-2">
      <Skeleton className="h-9 w-72 rounded-full" />
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-hairline py-3">
          <Skeleton className="size-[26px] rounded-full" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="ml-auto h-4 w-20" />
        </div>
      ))}
    </div>
  );
}
