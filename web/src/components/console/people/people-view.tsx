"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Plus, Search, UsersRound } from "lucide-react";
import { Usd } from "@/components/app/amount";
import { ErrorState, EmptyState } from "@/components/app/states";
import { Initials } from "@/components/ds/avatar";
import { PageTitle } from "@/components/ds/page";
import { Tag } from "@/components/ds/tag";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useResource } from "@/hooks/use-resource";
import { api, type Contractor, type Run } from "@/lib/api";
import { formatCount, formatPeriodLabel } from "@/lib/format";
import { lastPaidByContractor, personSubline, settlementLabel, shortDate } from "@/components/console/lib";
import { ContractorDialog } from "@/components/console/people/contractor-dialog";
import { ArchiveDialog, PersonDrawer } from "@/components/console/people/person-drawer";

/** Set or clear one search parameter without a server round trip (Next syncs useSearchParams). */
function setParam(pathname: string, key: string, value: string | null) {
  const params = new URLSearchParams(window.location.search);
  if (value === null) params.delete(key);
  else params.set(key, value);
  const q = params.toString();
  window.history.replaceState(null, "", q ? `${pathname}?${q}` : pathname);
}

export function PeopleView({ initial }: { initial: { contractors?: Contractor[]; runs?: Run[] } }) {
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
        [c.name, c.email ?? "", c.unified_address, `account ${c.account_index}`, settlementLabel(c)].some((v) =>
          v.toLowerCase().includes(q),
        ),
      )
    : list;
  const selected = selectedId ? list.find((c) => c.id === selectedId) : undefined;

  const open = (c: Contractor) => setParam(pathname, "person", c.id);
  const close = () => setParam(pathname, "person", null);
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
        <ErrorState error={contractors.error} onRetry={contractors.reload} />
      ) : !contractors.data ? (
        <PeopleSkeleton />
      ) : list.length === 0 ? (
        <div className="rounded-xl border">
          <EmptyState
            icon={<UsersRound />}
            title="No contractors yet"
            action={
              <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
                <Plus aria-hidden="true" />
                Add contractor
              </Button>
            }
          >
            Each person gets a private account and a key to their own payslips.
          </EmptyState>
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
            <span className="ml-auto text-sm text-muted-foreground" aria-live="polite">
              {q ? `${formatCount(shown.length)} of ${formatCount(list.length)}` : `${formatCount(list.length)} people`}
            </span>
          </div>

          <table className="w-full border-collapse text-[0.9375rem]">
            <caption className="sr-only">Contractors. Select a person to see their details and payments.</caption>
            <thead>
              <tr className="border-b border-hairline text-left text-[0.8125rem] text-muted-foreground">
                <th scope="col" className="py-3 pr-3 font-normal">
                  Name
                </th>
                <th scope="col" className="hidden py-3 pr-3 font-normal md:table-cell">
                  Settlement
                </th>
                <th scope="col" className="hidden py-3 pr-3 font-normal lg:table-cell">
                  Account
                </th>
                <th scope="col" className="hidden py-3 pr-3 font-normal sm:table-cell">
                  Payslip access
                </th>
                <th scope="col" className="py-3 text-right font-normal">
                  Last paid
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr className="border-b border-hairline">
                  <td colSpan={5} className="h-[52px] text-sm text-muted-foreground">
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
                      className="cursor-pointer border-b border-hairline transition-colors hover:bg-muted/60 data-[state=selected]:bg-muted"
                    >
                      <td className="h-[56px] py-2 pr-3">
                        <span className="flex min-w-0 items-center gap-3">
                          <Initials name={c.name} />
                          <span className="min-w-0">
                            <button
                              type="button"
                              aria-haspopup="dialog"
                              className="block max-w-full truncate rounded-sm text-left"
                            >
                              {c.name}
                            </button>
                            <span className="block truncate text-xs text-muted-foreground md:hidden">
                              {personSubline(c)}
                            </span>
                            {c.email ? (
                              <span className="hidden truncate text-xs text-muted-foreground md:block">{c.email}</span>
                            ) : null}
                          </span>
                        </span>
                      </td>
                      <td className="hidden pr-3 whitespace-nowrap text-strong md:table-cell">{settlementLabel(c)}</td>
                      <td className="num hidden pr-3 text-strong lg:table-cell">{c.account_index}</td>
                      <td className="hidden pr-3 sm:table-cell">
                        {c.fvk_shared_at ? (
                          <span className="inline-flex items-center gap-2 whitespace-nowrap">
                            <Tag>Shared</Tag>
                            <span className="text-xs text-muted-foreground">{shortDate(c.fvk_shared_at)}</span>
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">Not shared</span>
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {lp ? (
                          <>
                            <Usd cents={lp.cents} className="block" />
                            <span className="block text-xs whitespace-nowrap text-muted-foreground">
                              {shortDate(lp.date)} · {formatPeriodLabel(lp.period)}
                            </span>
                          </>
                        ) : (
                          <span className="text-sm text-muted-foreground">Never</span>
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
        onClose={() => setArchiving(null)}
        onArchived={(id) => {
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
