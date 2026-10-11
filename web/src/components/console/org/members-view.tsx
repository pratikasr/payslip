"use client";

import Link from "next/link";
import { useState } from "react";
import { MailPlus, UserMinus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/components/auth/auth-provider";
import { Initials } from "@/components/ds/avatar";
import { PageTitle } from "@/components/ds/page";
import { Tag } from "@/components/ds/tag";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { useResource } from "@/hooks/use-resource";
import { api, toDisplayError, type Membership, type OrgMember } from "@/lib/api";
import { formatShortDate } from "@/lib/format";
import { ROLE_HELP, ROLE_LABELS, ROLES, roleLabel } from "@/lib/roles";
import { Problem } from "@/components/runs/problem";

/** Who is in the organisation and in which role. Admins change roles and remove people. */
export function MembersView({ initial }: { initial?: OrgMember[] }) {
  const auth = useAuth();
  const members = useResource((s) => api.members(s), "org-members", initial);
  const [removing, setRemoving] = useState<OrgMember | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const admin = auth.can("manage_org");
  const list = members.data ?? [];
  const admins = list.filter((m) => m.role === "admin").length;

  const setRole = async (m: OrgMember, role: Membership["role"]) => {
    setBusy(m.user_id);
    try {
      const updated = await api.setMemberRole(m.user_id, role);
      members.setData((prev) => (prev ?? []).map((p) => (p.user_id === updated.user_id ? updated : p)));
      toast.success(`${m.name || m.email} is now ${roleLabel(role).toLowerCase()}`);
    } catch (err) {
      const e = toDisplayError(err);
      toast.error(e.message, { description: e.hint });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (m: OrgMember) => {
    setBusy(m.user_id);
    try {
      await api.removeMember(m.user_id);
      members.setData((prev) => (prev ?? []).filter((p) => p.user_id !== m.user_id));
      toast.success(`${m.name || m.email} was removed`);
      setRemoving(null);
    } catch (err) {
      const e = toDisplayError(err);
      toast.error(e.message, { description: e.hint });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageTitle
        title="Members"
        description="Everyone who can sign in to this organisation, and what their role lets them do."
        actions={
          admin ? (
            <Button asChild>
              <Link href="/console/invitations">
                <MailPlus aria-hidden="true" />
                Invite someone
              </Link>
            </Button>
          ) : undefined
        }
      />
      {members.error && !members.data ? (
        <Problem error={members.error} title="Could not load the members" onRetry={members.reload} />
      ) : !members.data ? (
        <div role="status" aria-label="Loading members" className="grid gap-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : (
        <table className="w-full text-[0.9375rem]">
          <caption className="sr-only">Members and their roles</caption>
          <thead>
            <tr className="border-b border-hairline text-left text-[0.8125rem] text-muted-foreground">
              <th scope="col" className="py-2 pr-3 font-normal">
                Person
              </th>
              <th scope="col" className="py-2 pr-3 font-normal">
                Role
              </th>
              <th scope="col" className="hidden py-2 pr-3 font-normal sm:table-cell">
                Since
              </th>
              {admin ? (
                <th scope="col" className="py-2 text-right font-normal">
                  <span className="sr-only">Actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {list.map((m) => {
              const you = m.user_id === auth.me?.user.id;
              const lastAdmin = m.role === "admin" && admins <= 1;
              return (
                <tr key={m.user_id} className="border-b border-hairline" data-testid="member-row">
                  <td className="py-3 pr-3">
                    <span className="flex items-center gap-2.5">
                      {m.picture_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={m.picture_url} alt="" className="size-7 shrink-0 rounded-full object-cover" />
                      ) : (
                        <Initials name={m.name || m.email} />
                      )}
                      <span className="grid min-w-0">
                        <span className="truncate">
                          {m.name || m.email}
                          {you ? <span className="text-muted-foreground"> (you)</span> : null}
                        </span>
                        {m.name ? (
                          <span className="truncate text-[0.8125rem] text-muted-foreground">{m.email}</span>
                        ) : null}
                      </span>
                    </span>
                  </td>
                  <td className="py-3 pr-3">
                    {admin ? (
                      <NativeSelect
                        aria-label={`Role of ${m.name || m.email}`}
                        value={m.role}
                        disabled={busy === m.user_id || lastAdmin}
                        title={lastAdmin ? "The only admin: make someone else an admin first." : ROLE_HELP[m.role]}
                        onChange={(e) => void setRole(m, e.target.value as Membership["role"])}
                        className="w-[150px]"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </NativeSelect>
                    ) : (
                      <Tag title={ROLE_HELP[m.role]}>{roleLabel(m.role)}</Tag>
                    )}
                  </td>
                  <td className="hidden py-3 pr-3 text-muted-foreground sm:table-cell">
                    {formatShortDate(m.created_at)}
                  </td>
                  {admin ? (
                    <td className="py-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy === m.user_id || lastAdmin}
                        onClick={() => setRemoving(m)}
                        title={lastAdmin ? "The only admin cannot be removed." : undefined}
                      >
                        <UserMinus aria-hidden="true" />
                        Remove
                      </Button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <Dialog open={!!removing} onOpenChange={(o) => (o ? null : setRemoving(null))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removing?.name || removing?.email}?</DialogTitle>
            <DialogDescription>
              They can no longer sign in to this organisation. Payroll they ran stays on record, and an admin can invite
              them again later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              Keep
            </Button>
            <Button variant="destructive" disabled={!!busy} onClick={() => removing && void remove(removing)}>
              {busy ? "Removing" : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
