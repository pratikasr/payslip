"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import { Check, Download, FileKey2, Landmark, QrCode as QrIcon } from "lucide-react";
import { toast } from "sonner";
import { CopyButton } from "@/components/app/copy-button";
import { Initials } from "@/components/ds/avatar";
import { Card, CardHeader } from "@/components/ds/card";
import { Disclosure } from "@/components/ds/disclosure";
import { PageTitle, SectionHeader } from "@/components/ds/page";
import { MaskedSecret, SENSITIVE, Sensitive } from "@/components/ds/sensitive";
import { StatusTag } from "@/components/ds/status";
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
import { configuredPortalOrigin, isPrivateOrigin, publicOrigin } from "@/lib/public-url";
import { formatCount, formatDate, formatHeight, formatShortDate, networkLabel, todayIso } from "@/lib/format";
import { cn } from "cn";
import { AUDITOR_DOWNLOAD_KEY, inviteLink } from "@/components/console/lib";
import { ArrowLink, Bar, IconChip, MiniStats } from "@/components/console/ui";
import { Problem } from "@/components/runs/problem";
import { accessTag } from "@/components/runs/run-meta";

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
  // Services from before 5 Oct 2026 cannot undo Mark as shared (404 or 405): stop offering it.
  const [undoable, setUndoable] = useState(true);

  // Invite links open on the configured portal (NEXT_PUBLIC_PAYSLIP_PORTAL_URL), else here.
  useEffect(() => setOrigin(publicOrigin()), []);

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

  const replace = (updated: Contractor) => {
    contractors.setData((prev) => (prev ?? []).map((p) => (p.id === updated.id ? updated : p)));
    setInviting((cur) => (cur?.id === updated.id ? updated : cur));
  };

  /** Clears the shared mark (DELETE .../viewing-key/shared). It changes the record only. */
  const unmarkShared = async (c: Contractor) => {
    setMarking(c.id);
    try {
      const updated = await api.unmarkViewingKeyShared(c.id);
      replace(updated ?? { ...c, fvk_shared_at: null });
      toast.success(`${c.name} is marked as not shared`, {
        description: "Only the record changed: a link already sent still opens their payslips.",
      });
    } catch (err) {
      const e = toDisplayError(err);
      if (e.status === 404 || e.status === 405) {
        setUndoable(false);
        toast.error("This Payslip service cannot undo Mark as shared", {
          description: "It is an older version. The mark stays.",
        });
      } else toast.error(e.message, { description: e.hint });
    } finally {
      setMarking(null);
    }
  };

  const markShared = async (c: Contractor) => {
    setMarking(c.id);
    try {
      const updated = await api.markViewingKeyShared(c.id);
      replace(updated);
      toast.success(`Marked as shared with ${updated.name}`, {
        action: undoable ? { label: "Undo", onClick: () => void unmarkShared(updated) } : undefined,
      });
    } catch (err) {
      const e = toDisplayError(err);
      toast.error(e.message, { description: e.hint });
    } finally {
      setMarking(null);
    }
  };

  const shared = list.filter((c) => c.fvk_shared_at);

  return (
    <>
      <PageTitle
        title="Payslip access"
        description="A viewing key shows one account's payments and cannot move money. Once shared it cannot be revoked, so send each key only to the person it belongs to."
      />

      {origin && !configuredPortalOrigin() && isPrivateOrigin(origin) ? <LocalLinksNote origin={origin} /> : null}

      {contractors.error && !contractors.data ? (
        <Problem error={contractors.error} title="Could not load your people" onRetry={contractors.reload} />
      ) : (
        <>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <Card className="flex flex-col" aria-labelledby="invites-title">
              <CardHeader id="invites-title" title="Contractor invites" actions={<IconChip icon={FileKey2} />} />
              {contractors.data ? (
                <>
                  <div className="mt-1 text-[1.1875rem] font-[380]">
                    {formatCount(shared.length)} of {formatCount(list.length)} shared
                  </div>
                  <Bar value={list.length ? shared.length / list.length : 0} label="Invites shared" className="mt-4" />
                  {list.length === 0 ? (
                    <p className="mt-4 text-[0.9375rem] text-strong">Add people first; each gets their own key.</p>
                  ) : (
                    <InviteChecklist people={list} />
                  )}
                  <HowInvitesWork />
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
            {/* Fixed layout: a long name truncates in its column instead of widening the page. */}
            <table className="w-full table-fixed border-collapse text-[0.9375rem]" aria-labelledby="keys-title">
              <thead>
                <tr className="border-b border-hairline text-left text-[0.8125rem] text-muted-foreground">
                  <th scope="col" className="py-3 pr-3 font-normal">
                    Holder
                  </th>
                  <th scope="col" className="hidden w-[10rem] py-3 pr-3 font-normal lg:table-cell">
                    Access
                  </th>
                  <th scope="col" className="hidden w-[15rem] py-3 pr-3 font-normal xl:table-cell">
                    Invite link
                  </th>
                  <th scope="col" className="w-[5rem] py-3 text-right font-normal lg:w-[12.5rem]">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-hairline">
                  <td className="h-[60px] w-full max-w-0 py-2 pr-3">
                    <span className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="grid size-[26px] shrink-0 place-items-center rounded-full bg-chip text-strong"
                      >
                        <Landmark className="size-3.5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate">Treasury</span>
                        <span className="block truncate text-[0.8125rem] text-muted-foreground">Company</span>
                      </span>
                    </span>
                  </td>
                  <td className="hidden pr-3 lg:table-cell">
                    <Tag>Accountant only</Tag>
                  </td>
                  <td className="hidden pr-3 text-[0.8125rem] text-muted-foreground xl:table-cell">
                    In the key file for your accountant
                  </td>
                  <td className="text-right">
                    <a
                      href="#auditor-package"
                      className="rounded-sm text-[0.8125rem] whitespace-nowrap text-link hover:underline"
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
                      const link =
                        k && origin
                          ? inviteLink(origin, k.ufvk, {
                              name: c.name,
                              birthday: k.birthday_height ?? keys.data?.birthday_height,
                            })
                          : null;
                      return (
                        <tr
                          key={c.id}
                          id={`person-${c.id}`}
                          className="scroll-mt-24 border-b border-hairline transition-colors duration-700 data-[highlight]:bg-primary-soft"
                        >
                          <td className="h-[60px] w-full max-w-0 py-2 pr-3">
                            <span className="flex min-w-0 items-center gap-3">
                              <Initials name={c.name} />
                              <span className="min-w-0">
                                <span className="block truncate" title={c.name}>
                                  {c.name}
                                </span>
                                <span className="block truncate text-[0.8125rem] text-muted-foreground">
                                  <span className="lg:hidden">
                                    {c.fvk_shared_at ? `Shared ${formatShortDate(c.fvk_shared_at)}` : "Not shared"}
                                  </span>
                                  <span className="hidden lg:inline">Contractor</span>
                                </span>
                              </span>
                            </span>
                          </td>
                          <td className="hidden pr-3 lg:table-cell">
                            <span className="inline-flex items-center gap-2 whitespace-nowrap">
                              <StatusTag status={accessTag(c)} />
                              {c.fvk_shared_at ? (
                                <span className="text-[0.8125rem] text-muted-foreground">
                                  {formatShortDate(c.fvk_shared_at)}
                                </span>
                              ) : null}
                            </span>
                          </td>
                          <td className="hidden pr-3 xl:table-cell">
                            {link && k ? (
                              <MaskedSecret
                                value={link}
                                masked={`${k.ufvk.slice(0, 10)}…••••••`}
                                label={`invite link for ${c.name}`}
                              />
                            ) : keys.error ? (
                              <span className="text-[0.8125rem] text-muted-foreground">Key unavailable</span>
                            ) : (
                              <Skeleton className="h-3.5 w-48" />
                            )}
                          </td>
                          <td className="py-2 text-right whitespace-nowrap">
                            <span className="inline-flex items-center gap-1">
                              {link ? (
                                <CopyButton
                                  value={link}
                                  label={`invite link for ${c.name}`}
                                  size="icon-sm"
                                  className="xl:hidden"
                                />
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
                                  aria-label={`Mark as shared, ${c.name}`}
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
          {keys.error ? (
            <Problem
              error={keys.error}
              title="Could not load the viewing keys"
              onRetry={keys.reload}
              className="mt-4"
            />
          ) : null}
        </>
      )}

      <InviteDialog
        contractor={inviting}
        entry={inviting ? keyFor.get(inviting.id) : undefined}
        fileBirthday={keys.data?.birthday_height}
        origin={origin}
        marking={!!inviting && marking === inviting.id}
        onMark={markShared}
        onUnmark={undoable ? unmarkShared : undefined}
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
  // Downloading the file or copying its text both count as sending it (Home's to-do clears).
  const markSent = () => {
    const now = new Date().toISOString();
    setDownloadedAt(now);
    try {
      localStorage.setItem(AUDITOR_DOWNLOAD_KEY, now);
    } catch {
      /* storage blocked: the to-do stays, nothing else changes */
    }
  };
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
    markSent();
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
        <Problem error={error} title="Could not load the viewing keys" onRetry={onRetry} className="mt-3" />
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
          {data ? <CopyButton value={json} label="key file" size="icon-sm" onCopied={markSent} /> : null}
          {/* Books loads keys itself ("Load this company's keys" or the file): this only goes there. */}
          <ArrowLink href="/books" className="ml-auto text-[0.8125rem]">
            Go to Books
          </ArrowLink>
        </div>
      </div>
      {downloadedAt ? (
        <p className="mt-2 text-[0.8125rem] text-muted-foreground">
          Downloaded or copied {formatDate(downloadedAt)} in this browser.
        </p>
      ) : null}
    </Card>
  );
}

function InviteDialog({
  contractor,
  entry,
  fileBirthday,
  origin,
  marking,
  onMark,
  onUnmark,
  onClose,
}: {
  contractor: Contractor | null;
  entry: ViewingKeyExportEntry | undefined;
  fileBirthday: number | undefined;
  origin: string;
  marking: boolean;
  onMark: (c: Contractor) => void;
  /** Undo a mark; absent when this service cannot. */
  onUnmark?: (c: Contractor) => void;
  onClose: () => void;
}) {
  const link =
    entry && origin && contractor
      ? inviteLink(origin, entry.ufvk, { name: contractor.name, birthday: entry.birthday_height ?? fileBirthday })
      : "";
  return (
    <Dialog open={!!contractor} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-[520px]"
        onOpenAutoFocus={(e) => {
          // Start on the dialog itself: focusing the link field would select (highlight) the key.
          e.preventDefault();
          (e.currentTarget as HTMLElement).focus();
        }}
      >
        <DialogHeader className="gap-1.5 px-6 pt-6 pb-4">
          <DialogTitle className="text-[1.1875rem] leading-tight font-[380] tracking-[-0.01em] [overflow-wrap:anywhere]">
            Invite {contractor?.name}
          </DialogTitle>
          <DialogDescription className="text-[0.9375rem]">
            This link opens {contractor?.name}&apos;s payslips. Anyone holding it can read their payments, so send it
            privately.
          </DialogDescription>
        </DialogHeader>
        {contractor && entry ? (
          <div className="grid gap-4 px-6 pb-6">
            {origin && !configuredPortalOrigin() && isPrivateOrigin(origin) ? (
              <p className="rounded-lg bg-warning-bg px-3 py-2 text-[0.8125rem] text-strong" role="note">
                This link opens only on this computer or its network ({origin.replace(/^https?:\/\//, "")}).
              </p>
            ) : null}
            <Sensitive block className="justify-self-center">
              <QrCode value={link} label={`QR code of the invite link for ${contractor.name}`} size={260} />
            </Sensitive>
            <div className="space-y-1.5">
              <label htmlFor="invite-link" className="text-[0.8125rem] font-medium">
                Invite link
              </label>
              <div className="flex items-center gap-1">
                <input
                  id="invite-link"
                  readOnly
                  value={link}
                  onFocus={(e) => e.currentTarget.select()}
                  className={cn(
                    "h-9 min-w-0 flex-1 rounded-lg border bg-raised px-2.5 font-mono text-[0.8125rem] outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40",
                    SENSITIVE,
                  )}
                />
                <CopyButton value={link} label={`invite link for ${contractor.name}`} size="icon-sm" />
              </div>
            </div>
            <Disclosure summary="Advanced: the viewing key itself" className="rounded-lg border px-3.5 py-2.5">
              <div className="grid gap-3">
                <KeyField label="Viewing key" value={entry.ufvk} copyLabel={`viewing key for ${contractor.name}`} />
                {entry.ufvk_wallet && entry.ufvk_wallet !== entry.ufvk ? (
                  <KeyField
                    label="For wallet apps such as Zingo and Zkool"
                    value={entry.ufvk_wallet}
                    copyLabel={`wallet app viewing key for ${contractor.name}`}
                  />
                ) : null}
              </div>
            </Disclosure>
          </div>
        ) : null}
        <DialogFooter className="mx-0 mb-0 rounded-b-xl px-6 py-4 sm:items-center sm:justify-between">
          <p className="text-[0.8125rem] text-muted-foreground">
            {contractor?.fvk_shared_at ? (
              <>
                Marked as shared on {formatDate(contractor.fvk_shared_at)}.
                {onUnmark ? (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="rounded-sm text-link hover:underline"
                      disabled={marking}
                      onClick={() => onUnmark(contractor)}
                    >
                      Mark as not shared
                    </button>
                  </>
                ) : null}
              </>
            ) : (
              "Not marked as shared yet."
            )}
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
        <span className="text-[0.8125rem] text-muted-foreground">{label}</span>
        <CopyButton value={value} label={copyLabel} />
      </div>
      <code
        className={cn(
          "block max-h-24 overflow-y-auto rounded-md bg-raised p-2 font-mono text-[11px] break-all",
          SENSITIVE,
        )}
      >
        {value}
      </code>
    </div>
  );
}

/**
 * Shown when invite links would point at this machine: the console runs on a loopback or private
 * address and no public portal is configured, so a contractor's own device cannot open them.
 */
function LocalLinksNote({ origin }: { origin: string }) {
  return (
    <div role="note" className="mb-5 rounded-xl bg-warning-bg px-4 py-3.5 text-[0.9375rem] sm:px-5">
      <p className="text-foreground">Invite links open only on this computer or its network</p>
      <p className="mt-1 text-[0.8125rem] text-strong [overflow-wrap:anywhere]">
        This console runs at {origin.replace(/^https?:\/\//, "")}, which a contractor&apos;s phone cannot reach. To send
        links they can open, whoever runs Payslip sets NEXT_PUBLIC_PAYSLIP_PORTAL_URL to a Payslip address contractors
        can reach, such as a statements-only deployment.
      </p>
    </div>
  );
}

/** Each person's invite at a glance: a tick once it is marked as shared. */
function InviteChecklist({ people }: { people: Contractor[] }) {
  const shown = people.slice(0, 6);
  const rest = people.length - shown.length;
  return (
    <ul className="mt-4 grid gap-x-5 gap-y-1.5 text-[0.9375rem] sm:grid-cols-2">
      {shown.map((c) => (
        <li key={c.id} className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden="true"
            className={cn(
              "grid size-[18px] shrink-0 place-items-center rounded-full border",
              c.fvk_shared_at ? "border-transparent bg-success-bg text-success" : "border-border",
            )}
          >
            {c.fvk_shared_at ? <Check className="size-3" /> : null}
          </span>
          <a href={`#person-${c.id}`} className="min-w-0 truncate rounded-sm hover:underline" title={c.name}>
            {c.name}
          </a>
          <span className="sr-only">{c.fvk_shared_at ? ", shared" : ", not shared"}</span>
        </li>
      ))}
      {rest > 0 ? <li className="text-[0.8125rem] text-muted-foreground">and {rest} more in the table below</li> : null}
    </ul>
  );
}

/** What an invite does, in three steps, under the checklist. */
function HowInvitesWork() {
  const steps = [
    "Copy their invite link, or let them scan the QR code",
    "They open it on their own device",
    "They read their own payslips, and nothing else",
  ];
  return (
    <div className="mt-auto pt-5">
      <p className="border-t border-hairline pt-3.5 text-[0.8125rem] text-muted-foreground">How invites work</p>
      <ol className="mt-2 grid gap-2 text-[0.8125rem] text-strong sm:grid-cols-3">
        {steps.map((step, i) => (
          <li key={step} className="flex gap-2">
            <span
              aria-hidden="true"
              className="grid size-5 shrink-0 place-items-center rounded-full bg-chip text-[11px] text-muted-foreground"
            >
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
