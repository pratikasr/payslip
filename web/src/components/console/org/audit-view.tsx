"use client";

import { useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { PageTitle } from "@/components/ds/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useResource } from "@/hooks/use-resource";
import { api, toDisplayError, type AuditEntry } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { roleLabel } from "@/lib/roles";
import { Problem } from "@/components/runs/problem";
import { OnlyAdmins } from "./only-admins";

const PAGE = 100;

/** The audit actions in words (service/src/auth/mod.rs `rule`). */
const ACTIONS: Record<string, string> = {
  "org.bootstrap": "Created the organisation",
  "org.update": "Changed the organisation's name or logo",
  "member.role": "Changed a member's role",
  "member.remove": "Removed a member",
  "invitation.create": "Invited someone",
  "invitation.revoke": "Revoked an invitation",
  "invitation.accept": "Joined by invitation",
  "wallet.sync": "Synced the wallet",
  "contractor.create": "Added a person",
  "contractor.update": "Edited a person",
  "contractor.archive": "Archived a person",
  "contractor.key_view": "Viewed a viewing key",
  "contractor.key_shared": "Marked a viewing key as shared",
  "contractor.key_unshared": "Marked a viewing key as not shared",
  "keys.export": "Exported every viewing key",
  "run.create": "Created a payroll run",
  "run.discard": "Discarded a draft run",
  "run.fund": "Funded a run",
  "run.deposit_tx": "Reported a deposit",
  "run.execute": "Executed a run",
  "run.approve": "Approved a payroll run",
  "run.cancel": "Cancelled a run",
};

function describe(e: AuditEntry): string {
  const base = ACTIONS[e.action] ?? e.action;
  const d = e.details ?? {};
  const email = typeof d.email === "string" ? d.email : null;
  const to = typeof d.to === "string" ? roleLabel(d.to).toLowerCase() : null;
  const role = typeof d.role === "string" ? roleLabel(d.role).toLowerCase() : null;
  if (e.action === "member.role" && email && to) return `Made ${email} ${to}`;
  if (e.action === "invitation.create" && email && role) return `Invited ${email} as ${role}`;
  if ((e.action === "member.remove" || e.action === "invitation.revoke") && email) return `${base}: ${email}`;
  if (e.action === "org.update" && typeof d.name === "string") return `Renamed the organisation to ${d.name}`;
  return base;
}

/** Who did what, newest first. Admins and accountants. */
export function AuditView({ initial }: { initial?: AuditEntry[] }) {
  const auth = useAuth();
  const entries = useResource((s) => api.audit({ limit: PAGE }, s), "org-audit", initial);
  const [more, setMore] = useState<"idle" | "loading" | "done">("idle");

  if (!auth.can("view_audit")) return <OnlyAdmins what="read the audit log" who="an admin or an accountant" />;

  const list = entries.data ?? [];
  const loadMore = async () => {
    const last = list[list.length - 1];
    if (!last) return;
    setMore("loading");
    try {
      const older = await api.audit({ limit: PAGE, before: last.id });
      entries.setData((prev) => [...(prev ?? []), ...older]);
      setMore(older.length < PAGE ? "done" : "idle");
    } catch (err) {
      const e = toDisplayError(err);
      setMore("idle");
      entries.setData((prev) => prev ?? []);
      throw e;
    }
  };

  return (
    <>
      <PageTitle
        title="Audit log"
        description="Every change made through the console: who made it, in which role, to what, and when. Reads are not logged, except viewing-key exports."
      />
      {entries.error && !entries.data ? (
        <Problem error={entries.error} title="Could not load the audit log" onRetry={entries.reload} />
      ) : !entries.data ? (
        <div role="status" aria-label="Loading the audit log" className="grid gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <p className="border-y-2 border-ink px-2 py-4 font-type text-[0.9375rem] text-muted-foreground">
          Nothing has been changed yet. Every change to members, roles and runs is written here.
        </p>
      ) : (
        <>
          <table className="w-full border-collapse border-b-2 border-ink text-[0.875rem] sm:text-[0.9375rem]">
            <caption className="sr-only">Audit log, newest first</caption>
            <thead>
              <tr className="border-b-2 border-ink text-left text-[0.75rem]">
                <th scope="col" className="py-2.5 pr-3 pl-2 font-bold">
                  When
                </th>
                <th scope="col" className="py-2 pr-3 font-bold">
                  Who
                </th>
                <th scope="col" className="py-2 pr-3 font-bold">
                  What
                </th>
                <th scope="col" className="hidden py-2 font-bold md:table-cell">
                  Target
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id} className="border-b border-bar-line align-top" data-testid="audit-row">
                  <td className="py-2.5 pr-3 pl-2 whitespace-nowrap text-muted-foreground">{formatDateTime(e.at)}</td>
                  <td className="py-2.5 pr-3">
                    <span className="grid min-w-0">
                      <span className="truncate font-bold">{e.user?.name || e.user?.email || "Unknown"}</span>
                      <span className="text-[0.8125rem] text-muted-foreground">{roleLabel(e.role)}</span>
                    </span>
                  </td>
                  <td className="py-2.5 pr-3">{describe(e)}</td>
                  <td className="hidden py-2.5 font-type text-[0.8125rem] text-muted-foreground md:table-cell">
                    {e.target ? (
                      <span title={e.target}>{e.target.length > 18 ? `${e.target.slice(0, 8)}…` : e.target}</span>
                    ) : (
                      ""
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length >= PAGE && more !== "done" ? (
            <div className="mt-4">
              <Button variant="secondary" onClick={() => void loadMore()} disabled={more === "loading"}>
                {more === "loading" ? "Loading" : "Show older entries"}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
