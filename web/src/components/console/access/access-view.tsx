"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { Download, FileKey2, Landmark, QrCode as QrIcon } from "lucide-react";
import { toast } from "sonner";
import { CopyButton } from "@/components/app/copy-button";
import { ErrorState } from "@/components/app/states";
import { Initials } from "@/components/ds/avatar";
import { Card, CardHeader } from "@/components/ds/card";
import { PageTitle, SectionHeader } from "@/components/ds/page";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useResource } from "@/hooks/use-resource";
import { api, toDisplayError, type Contractor, type ViewingKeyExport, type ViewingKeyExportEntry } from "@/lib/api";
import { saveText } from "@/lib/download";
import { formatCount, formatDate, formatDateTime, formatHeight, networkLabel, todayIso } from "@/lib/format";
import { cn } from "cn";
import { AUDITOR_DOWNLOAD_KEY, inviteLink, nameList, shortDate } from "@/components/console/lib";
import { ArrowLink, Bar, IconChip, MiniStats } from "@/components/console/ui";

const QrCode = dynamic(() => import("@/components/app/qr-code"), {
  ssr: false,
  loading: () => <Skeleton className="size-[244px]" />,
});

/** Payslip access: who holds which viewing key, invite links for contractors, and the auditor package. */
export function AccessView({ initial }: { initial: { contractors?: Contractor[] } }) {
  const contractors = useResource((s) => api.contractors(s), "access-contractors", initial.contractors);
  const keys = useResource((s) => api.viewingKeyExport(s), "access-keys");
  const [origin, setOrigin] = useState("");
  const [inviting, setInviting] = useState<Contractor | null>(null);
  const [marking, setMarking] = useState<string | null>(null);

  useEffect(() => setOrigin(window.location.origin), []);

  const list = useMemo(
    () => (contractors.data ?? []).slice().sort((a, b) => a.account_index - b.account_index),
    [contractors.data],
  );
  const keyFor = useMemo(() => {
    const m = new Map<string, ViewingKeyExportEntry>();
    for (const k of keys.data?.keys ?? []) if (k.contractor_id) m.set(k.contractor_id, k);
    return m;
  }, [keys.data]);

  // Arriving at #person-<id> (from a person's drawer) or #auditor-package: bring it into view.
  useEffect(() => {
    if (!contractors.data) return;
    const id = window.location.hash.slice(1);
    if (!id || !/^(person-|auditor-package$)/.test(id)) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    // A gold wash marks where the visitor landed, then fades.
    el.setAttribute("data-highlight", "");
    const t = setTimeout(() => el.removeAttribute("data-highlight"), 1800);
    return () => clearTimeout(t);
  }, [contractors.data]);

  const markShared = async (c: Contractor) => {
    setMarking(c.id);
    try {
      const updated = await api.markViewingKeyShared(c.id);
      contractors.setData((prev) => (prev ?? []).map((p) => (p.id === updated.id ? updated : p)));
      setInviting((cur) => (cur?.id === updated.id ? updated : cur));
      toast.success(`Marked as shared with ${updated.name}`);
    } catch (err) {
      const e = toDisplayError(err);
      toast.error(e.message, { description: e.hint });
    } finally {
      setMarking(null);
    }
  };

  const shared = list.filter((c) => c.fvk_shared_at);
  const waiting = list.filter((c) => !c.fvk_shared_at);

  return (
    <>
      <PageTitle
        title="Payslip access"
        description="A viewing key shows one account's payments and cannot move money. Once shared it cannot be revoked, so send each key only to the person it belongs to."
      />

      {contractors.error && !contractors.data ? (
        <ErrorState error={contractors.error} onRetry={contractors.reload} />
      ) : (
        <>
          <div className="grid gap-5 md:grid-cols-2">
            <Card className="flex flex-col" aria-labelledby="invites-title">
              <CardHeader id="invites-title" title="Contractor invites" actions={<IconChip icon={FileKey2} />} />
              {contractors.data ? (
                <>
                  <div className="mt-1 text-[1.1875rem] font-[380]">
                    {formatCount(shared.length)} of {formatCount(list.length)} shared
                  </div>
                  <Bar value={list.length ? shared.length / list.length : 0} label="Invites shared" className="mt-4" />
                  <p className="mt-3 text-sm text-muted-foreground">
                    Each link opens one person&apos;s payslips in the contractor portal.
                  </p>
                  <p className="mt-auto pt-4 text-[0.9375rem] text-strong">
                    {list.length === 0
                      ? "Add people first; each gets their own key."
                      : waiting.length === 0
                        ? "Everyone can read their own payslips."
                        : `Waiting: ${nameList(waiting.map((c) => c.name))}`}
                  </p>
                </>
              ) : (
                <div className="mt-2 space-y-3">
                  <Skeleton className="h-6 w-32" />
                  <Skeleton className="h-1.5 w-full" />
                </div>
              )}
            </Card>
            <AuditorPackage data={keys.data} error={keys.error} onRetry={keys.reload} />
          </div>

          <SectionHeader title="Viewing keys" id="keys-title" />
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full border-collapse text-[0.9375rem]" aria-labelledby="keys-title">
              <thead>
                <tr className="border-b border-hairline text-left text-[0.8125rem] text-muted-foreground">
                  <th scope="col" className="py-3 pr-3 font-normal">
                    Holder
                  </th>
                  <th scope="col" className="hidden py-3 pr-3 font-normal lg:table-cell">
                    Access
                  </th>
                  <th scope="col" className="hidden py-3 pr-3 font-normal xl:table-cell">
                    Invite link
                  </th>
                  <th scope="col" className="py-3 text-right font-normal">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-hairline">
                  <td className="h-[60px] py-2 pr-3">
                    <span className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="grid size-[26px] shrink-0 place-items-center rounded-full bg-chip text-strong"
                      >
                        <Landmark className="size-3.5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block">Treasury</span>
                        <span className="block text-xs text-muted-foreground">Company · Account 0</span>
                      </span>
                    </span>
                  </td>
                  <td className="hidden pr-3 lg:table-cell">
                    <Tag>Auditor package only</Tag>
                  </td>
                  <td className="hidden pr-3 text-sm text-muted-foreground xl:table-cell">
                    Shared with your accountant in the key file
                  </td>
                  <td className="text-right">
                    <a
                      href="#auditor-package"
                      className="rounded-sm text-sm text-link hover:underline"
                      onClick={(e) => {
                        e.preventDefault();
                        document
                          .getElementById("auditor-package")
                          ?.scrollIntoView({ block: "center", behavior: "smooth" });
                      }}
                    >
                      Key file
                    </a>
                  </td>
                </tr>
                {!contractors.data
                  ? Array.from({ length: 3 }).map((_, i) => (
                      <tr key={i} className="border-b border-hairline">
                        <td colSpan={4} className="h-[60px]">
                          <Skeleton className="h-4 w-56" />
                        </td>
                      </tr>
                    ))
                  : list.map((c) => {
                      const k = keyFor.get(c.id);
                      const link = k && origin ? inviteLink(origin, k.ufvk) : null;
                      return (
                        <tr
                          key={c.id}
                          id={`person-${c.id}`}
                          className="scroll-mt-24 border-b border-hairline transition-colors duration-700 data-[highlight]:bg-primary-soft"
                        >
                          <td className="h-[60px] py-2 pr-3">
                            <span className="flex min-w-0 items-center gap-3">
                              <Initials name={c.name} />
                              <span className="min-w-0">
                                <span className="block truncate">{c.name}</span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  Contractor · Account {c.account_index}
                                  <span className="lg:hidden">
                                    {" "}
                                    · {c.fvk_shared_at ? `Shared ${shortDate(c.fvk_shared_at)}` : "Not shared"}
                                  </span>
                                </span>
                              </span>
                            </span>
                          </td>
                          <td className="hidden pr-3 lg:table-cell">
                            {c.fvk_shared_at ? (
                              <span className="inline-flex items-center gap-2 whitespace-nowrap">
                                <Tag>Shared</Tag>
                                <span className="text-xs text-muted-foreground" title={formatDateTime(c.fvk_shared_at)}>
                                  {formatDate(c.fvk_shared_at)}
                                </span>
                              </span>
                            ) : (
                              <span className="text-sm text-muted-foreground">Not shared</span>
                            )}
                          </td>
                          <td className="hidden max-w-0 pr-3 xl:table-cell">
                            {link ? (
                              <code className="block truncate font-mono text-xs text-muted-foreground" title={link}>
                                {link.replace(/^https?:\/\//, "")}
                              </code>
                            ) : keys.error ? (
                              <span className="text-sm text-muted-foreground">Key unavailable</span>
                            ) : (
                              <Skeleton className="h-3.5 w-48" />
                            )}
                          </td>
                          <td className="py-2 text-right whitespace-nowrap">
                            <span className="inline-flex items-center gap-1">
                              {link ? (
                                <CopyButton value={link} label={`invite link for ${c.name}`} size="icon-sm" />
                              ) : null}
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="text-muted-foreground hover:text-foreground"
                                aria-label={`Invite ${c.name}: QR code and link`}
                                title="QR code and link"
                                disabled={!k}
                                onClick={() => setInviting(c)}
                              >
                                <QrIcon aria-hidden="true" />
                              </Button>
                              {c.fvk_shared_at ? null : (
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  className="ml-1 hidden lg:inline-flex"
                                  disabled={marking === c.id}
                                  onClick={() => markShared(c)}
                                  aria-label={`Mark the invite as shared with ${c.name}`}
                                >
                                  {marking === c.id ? "Saving" : "Mark as shared"}
                                </Button>
                              )}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>
          </div>
          {keys.error ? <ErrorState error={keys.error} onRetry={keys.reload} compact className="mt-4" /> : null}
        </>
      )}

      <InviteDialog
        contractor={inviting}
        entry={inviting ? keyFor.get(inviting.id) : undefined}
        origin={origin}
        marking={!!inviting && marking === inviting.id}
        onMark={markShared}
        onClose={() => setInviting(null)}
      />
    </>
  );
}

/** The auditor package: today's viewing key export JSON, for the accountant. */
function AuditorPackage({
  data,
  error,
  onRetry,
}: {
  data: ViewingKeyExport | undefined;
  error: ReturnType<typeof toDisplayError> | undefined;
  onRetry: () => void;
}) {
  const [downloadedAt, setDownloadedAt] = useState<string | null>(null);
  useEffect(() => {
    try {
      setDownloadedAt(localStorage.getItem(AUDITOR_DOWNLOAD_KEY));
    } catch {
      /* storage blocked: say nothing about past downloads */
    }
  }, []);
  const json = data ? JSON.stringify(data, null, 2) : "";
  const download = () => {
    if (!data) return;
    saveText(json, `payslip-viewing-keys-${data.network}-${todayIso()}.json`);
    const now = new Date().toISOString();
    setDownloadedAt(now);
    try {
      localStorage.setItem(AUDITOR_DOWNLOAD_KEY, now);
    } catch {
      /* ignore */
    }
  };
  return (
    <Card
      id="auditor-package"
      className="flex scroll-mt-24 flex-col transition-shadow duration-700 data-[highlight]:ring-2 data-[highlight]:ring-primary-edge/60"
      aria-labelledby="auditor-title"
    >
      <CardHeader id="auditor-title" title="Auditor package" actions={<IconChip icon={Download} />} />
      <p className="mt-1 text-[0.9375rem] text-strong">
        Every viewing key in one file for your accountant. It reads every run and cannot spend.
      </p>
      {error ? (
        <ErrorState error={error} onRetry={onRetry} compact className="mt-3" />
      ) : data ? (
        <MiniStats
          className="mt-3"
          items={[
            { label: "Keys", value: formatCount(data.keys.length) },
            { label: "Network", value: networkLabel(data.network) },
            { label: "From block", value: formatHeight(data.birthday_height) },
          ]}
        />
      ) : (
        <Skeleton className="mt-4 h-10 w-full" />
      )}
      <div className="mt-auto pt-4">
        <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-3.5">
          <Button variant="secondary" size="sm" onClick={download} disabled={!data}>
            <Download aria-hidden="true" />
            Download key file
          </Button>
          {data ? <CopyButton value={json} label="key file" size="icon-sm" /> : null}
          <ArrowLink href="/books" className="ml-auto text-sm">
            Open in Books
          </ArrowLink>
        </div>
      </div>
      {downloadedAt ? (
        <p className="mt-2 text-xs text-muted-foreground">Downloaded {formatDate(downloadedAt)} in this browser.</p>
      ) : null}
    </Card>
  );
}

function InviteDialog({
  contractor,
  entry,
  origin,
  marking,
  onMark,
  onClose,
}: {
  contractor: Contractor | null;
  entry: ViewingKeyExportEntry | undefined;
  origin: string;
  marking: boolean;
  onMark: (c: Contractor) => void;
  onClose: () => void;
}) {
  const link = entry && origin ? inviteLink(origin, entry.ufvk) : "";
  return (
    <Dialog open={!!contractor} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-[520px]">
        <DialogHeader className="gap-1.5 px-6 pt-6 pb-4">
          <DialogTitle className="text-[1.375rem] leading-tight font-[380] tracking-[-0.01em]">
            Invite {contractor?.name}
          </DialogTitle>
          <DialogDescription className="text-[0.9375rem]">
            This link opens {contractor?.name}&apos;s payslips. Anyone holding it can read their payments, so send it
            privately.
          </DialogDescription>
        </DialogHeader>
        {contractor && entry ? (
          <div className="grid gap-4 px-6 pb-6">
            <div className="justify-self-center">
              <QrCode value={link} label={`QR code of the invite link for ${contractor.name}`} size={220} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="invite-link" className="text-sm font-medium">
                Invite link
              </label>
              <div className="flex items-center gap-1">
                <input
                  id="invite-link"
                  readOnly
                  value={link}
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-9 min-w-0 flex-1 rounded-lg border bg-raised px-2.5 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
                />
                <CopyButton value={link} label={`invite link for ${contractor.name}`} size="icon-sm" />
              </div>
            </div>
            <details className="group rounded-lg border px-3.5 py-2.5 text-sm">
              <summary className="cursor-pointer text-strong">Advanced</summary>
              <div className="mt-3 grid gap-3">
                <KeyField label="Viewing key" value={entry.ufvk} copyLabel={`viewing key for ${contractor.name}`} />
                {entry.ufvk_wallet && entry.ufvk_wallet !== entry.ufvk ? (
                  <KeyField
                    label="For wallet apps such as Zingo and Zkool"
                    value={entry.ufvk_wallet}
                    copyLabel={`wallet app viewing key for ${contractor.name}`}
                  />
                ) : null}
              </div>
            </details>
          </div>
        ) : null}
        <DialogFooter className="mx-0 mb-0 rounded-b-xl px-6 py-4 sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            {contractor?.fvk_shared_at
              ? `Marked as shared on ${formatDate(contractor.fvk_shared_at)}.`
              : "Not marked as shared yet."}
          </p>
          {contractor && !contractor.fvk_shared_at ? (
            <Button onClick={() => onMark(contractor)} disabled={marking}>
              {marking ? "Saving" : "Mark as shared"}
            </Button>
          ) : (
            <Button variant="secondary" onClick={onClose}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KeyField({ label, value, copyLabel }: { label: string; value: string; copyLabel: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <CopyButton value={value} label={copyLabel} />
      </div>
      <code className={cn("block max-h-24 overflow-y-auto rounded-md bg-raised p-2 font-mono text-[11px] break-all")}>
        {value}
      </code>
    </div>
  );
}
