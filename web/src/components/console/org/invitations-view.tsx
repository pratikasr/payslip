"use client";

import { useEffect, useState } from "react";
import { MailPlus } from "lucide-react";
import { toast } from "sonner";
import { CopyButton } from "@/components/app/copy-button";
import { Field } from "@/components/app/field";
import { useAuth } from "@/components/auth/auth-provider";
import { Card, CardHeader } from "@/components/ds/card";
import { PageTitle, SectionHeader } from "@/components/ds/page";
import { Sensitive } from "@/components/ds/sensitive";
import { Tag, type TagTone } from "@/components/ds/tag";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { useResource } from "@/hooks/use-resource";
import { api, toDisplayError, type Invitation, type Membership } from "@/lib/api";
import { formatShortDate } from "@/lib/format";
import { ROLE_HELP, ROLE_LABELS, ROLES, roleLabel } from "@/lib/roles";
import { IconChip } from "@/components/console/ui";
import { Problem } from "@/components/runs/problem";
import { OnlyAdmins } from "./only-admins";

const STATUS: Record<Invitation["status"], { label: string; tone: TagTone }> = {
  pending: { label: "Open", tone: "info" },
  accepted: { label: "Accepted", tone: "success" },
  expired: { label: "Expired", tone: "neutral" },
  revoked: { label: "Revoked", tone: "neutral" },
};

/**
 * Invitations: copy-paste links, as contractor invites are. The link shows once, when it is
 * made; after that only its state is known (the service keeps a hash of the token).
 */
export function InvitationsView({ initial }: { initial?: Invitation[] }) {
  const auth = useAuth();
  const invitations = useResource((s) => api.invitations(s), "org-invitations", initial);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Membership["role"]>("viewer");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<ReturnType<typeof toDisplayError> | null>(null);
  const [made, setMade] = useState<{ email: string; role: string; link: string } | null>(null);
  const [origin, setOrigin] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => setOrigin(window.location.origin), []);

  if (!auth.can("manage_org")) return <OnlyAdmins what="invite people" />;

  const invite = async (event: React.FormEvent) => {
    event.preventDefault();
    setSending(true);
    setProblem(null);
    try {
      const inv = await api.invite(email.trim(), role);
      invitations.setData((prev) => [inv, ...(prev ?? []).filter((p) => p.email !== inv.email)]);
      setMade({ email: inv.email, role: inv.role, link: `${origin}/invite/${inv.token ?? ""}` });
      setEmail("");
    } catch (err) {
      setProblem(toDisplayError(err));
    } finally {
      setSending(false);
    }
  };

  const revoke = async (inv: Invitation) => {
    setBusy(inv.id);
    try {
      await api.revokeInvitation(inv.id);
      invitations.setData((prev) => (prev ?? []).map((p) => (p.id === inv.id ? { ...p, status: "revoked" } : p)));
      if (made?.email === inv.email) setMade(null);
      toast.success(`The invitation for ${inv.email} no longer opens`);
    } catch (err) {
      const e = toDisplayError(err);
      toast.error(e.message, { description: e.hint });
    } finally {
      setBusy(null);
    }
  };

  const list = (invitations.data ?? []).filter((i) => i.status !== "revoked");
  return (
    <>
      <PageTitle
        title="Invitations"
        description="Invite someone by email. They sign in with that Google account and open the link; the link works for seven days."
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card aria-labelledby="invite-title">
          <CardHeader id="invite-title" title="Invite someone" actions={<IconChip icon={MailPlus} />} />
          <form onSubmit={invite} className="mt-4 grid gap-4">
            <Field id="invite-email" label="Email" help="They must sign in with exactly this address.">
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="off"
                placeholder="name@company.com"
              />
            </Field>
            <Field id="invite-role" label="Role" help={ROLE_HELP[role]}>
              <NativeSelect
                id="invite-role"
                value={role}
                onChange={(e) => setRole(e.target.value as Membership["role"])}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {problem ? <Problem error={problem} /> : null}
            <div className="border-t border-ink pt-4">
              <Button type="submit" disabled={sending || !email.trim()}>
                {sending ? "Making the link" : "Make an invite link"}
              </Button>
            </div>
          </form>
        </Card>
        {made ? (
          <Card aria-labelledby="link-title" className="self-start" data-testid="invite-link-card">
            <CardHeader id="link-title" title="Send this link" />
            <p className="mt-2 text-[0.8125rem] text-muted-foreground">
              For {made.email}, as {roleLabel(made.role).toLowerCase()}. It is shown once: copy it now and send it to
              them yourself.
            </p>
            <div className="mt-3 flex items-center gap-1 border border-bar-line bg-bar px-3 py-2">
              <Sensitive className="min-w-0 flex-1 truncate font-type text-[0.8125rem]" block>
                <span data-testid="invite-link">{made.link}</span>
              </Sensitive>
              <CopyButton value={made.link} label={`invite link for ${made.email}`} />
            </div>
          </Card>
        ) : null}
      </div>
      <SectionHeader title="Sent" />
      {invitations.error && !invitations.data ? (
        <Problem error={invitations.error} title="Could not load the invitations" onRetry={invitations.reload} />
      ) : !invitations.data ? (
        <div role="status" aria-label="Loading invitations" className="grid gap-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <p className="border-y-2 border-ink px-2 py-4 font-type text-[0.9375rem] text-muted-foreground">
          No invitations yet. Invite someone above and their link shows here until they join.
        </p>
      ) : (
        <table className="w-full border-collapse border-b-2 border-ink text-[0.875rem] sm:text-[0.9375rem]">
          <caption className="sr-only">Invitations sent</caption>
          <thead>
            <tr className="border-b-2 border-ink text-left text-[0.75rem]">
              <th scope="col" className="py-2.5 pr-3 pl-2 font-bold">
                Email
              </th>
              <th scope="col" className="py-2 pr-3 font-bold">
                Role
              </th>
              <th scope="col" className="py-2 pr-3 font-bold">
                State
              </th>
              <th scope="col" className="hidden py-2 pr-3 font-bold sm:table-cell">
                Expires
              </th>
              <th scope="col" className="py-2 pr-2 text-right font-bold">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((inv) => (
              <tr key={inv.id} className="border-b border-bar-line" data-testid="invitation-row">
                <td className="py-3 pr-3 pl-2 font-bold [overflow-wrap:anywhere]">{inv.email}</td>
                <td className="py-3 pr-3">{roleLabel(inv.role)}</td>
                <td className="py-3 pr-3">
                  <Tag tone={STATUS[inv.status].tone}>{STATUS[inv.status].label}</Tag>
                </td>
                <td className="hidden py-3 pr-3 text-muted-foreground sm:table-cell">
                  {inv.status === "pending" ? formatShortDate(inv.expires_at) : ""}
                </td>
                <td className="py-3 pr-2 text-right">
                  {inv.status === "pending" ? (
                    <Button variant="ghost" size="sm" disabled={busy === inv.id} onClick={() => void revoke(inv)}>
                      Revoke
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
