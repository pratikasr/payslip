"use client";

import { useEffect, useState } from "react";
import { Archive, KeyRound, Pencil, Plus, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { Hash } from "@/components/app/hash";
import { Badge } from "@/components/app/status-badge";
import { EmptyState, ErrorState, PageHeader, Panel, TableSkeleton } from "@/components/app/states";
import { ContractorFormDialog } from "@/components/payer/contractor-form-dialog";
import { ExportKeysDialog } from "@/components/payer/export-keys-dialog";
import { ShareKeyDialog } from "@/components/payer/share-key-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useResource } from "@/hooks/use-resource";
import { api, toDisplayError, type Contractor } from "@/lib/api";
import { chainLabel } from "@/lib/addresses";
import { formatDate, truncateMiddle } from "@/lib/format";

export function ContractorsView() {
  const contractors = useResource((s) => api.contractors(s), "contractors");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Contractor | null>(null);
  const [sharing, setSharing] = useState<Contractor | null>(null);
  const [archiving, setArchiving] = useState<Contractor | null>(null);
  const [exporting, setExporting] = useState(false);

  // /app/payer/contractors?add=1 (from the setup guide) opens the Add contractor dialog.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("add") !== "1") return;
    url.searchParams.delete("add");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    setAdding(true);
  }, []);

  const upsert = (c: Contractor) =>
    contractors.setData((prev) => {
      const list = prev ?? [];
      return list.some((x) => x.id === c.id) ? list.map((x) => (x.id === c.id ? c : x)) : [...list, c];
    });

  const list = contractors.data ?? [];
  const sorted = [...list].sort((a, b) => a.account_index - b.account_index);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contractors"
        description="Each contractor is paid from a dedicated account, so their viewing key reveals their payments and nobody else's."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => setExporting(true)}
              disabled={!contractors.data || list.length === 0}
            >
              <KeyRound aria-hidden="true" />
              Export all viewing keys for accountant
            </Button>
            <Button onClick={() => setAdding(true)} disabled={!!contractors.error}>
              <Plus aria-hidden="true" />
              Add contractor
            </Button>
          </>
        }
      />

      {contractors.error ? (
        <ErrorState error={contractors.error} onRetry={contractors.reload} />
      ) : (
        <Panel>
          {!contractors.data ? (
            <TableSkeleton label="Loading contractors" columns={5} />
          ) : list.length === 0 ? (
            <EmptyState
              icon={<UsersRound />}
              title="Add your first contractor"
              action={
                <Button onClick={() => setAdding(true)}>
                  <Plus aria-hidden="true" />
                  Add contractor
                </Button>
              }
            >
              You need their name and a unified address from their Zcash wallet. Payslip creates their account and a
              viewing key you can share with them.
            </EmptyState>
          ) : (
            <>
              <ul className="divide-y md:hidden">
                {sorted.map((c) => (
                  <li key={c.id} className="space-y-2 px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{c.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Account {c.account_index},{" "}
                          {c.settlement_choice === "hold_zec"
                            ? "holds ZEC"
                            : `converts to USDC on ${chainLabel(c.payout_chain)}`}
                        </p>
                      </div>
                      {c.fvk_shared_at ? (
                        <Badge tone="success">Key shared</Badge>
                      ) : (
                        <Badge tone="warning">Not shared</Badge>
                      )}
                    </div>
                    <Hash
                      value={c.unified_address}
                      label={`unified address of ${c.name}`}
                      head={10}
                      tail={6}
                      className="text-xs"
                    />
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="sm" onClick={() => setSharing(c)}>
                        <KeyRound aria-hidden="true" />
                        Share viewing key
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setEditing(c)}
                        aria-label={`Edit ${c.name}`}
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setArchiving(c)}
                        aria-label={`Archive ${c.name}`}
                      >
                        <Archive aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="hidden md:block">
                <Table label="Contractors" minWidth={860}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Contractor</TableHead>
                      <TableHead numeric>Account</TableHead>
                      <TableHead>Unified address</TableHead>
                      <TableHead>Settlement</TableHead>
                      <TableHead>Viewing key</TableHead>
                      <TableHead className="text-right">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sorted.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          <div className="font-medium">{c.name}</div>
                          {c.email ? <div className="text-xs text-muted-foreground">{c.email}</div> : null}
                        </TableCell>
                        <TableCell numeric>{c.account_index}</TableCell>
                        <TableCell>
                          <Hash value={c.unified_address} label={`unified address of ${c.name}`} head={10} tail={6} />
                        </TableCell>
                        <TableCell>
                          {c.settlement_choice === "hold_zec" ? (
                            "Hold ZEC"
                          ) : (
                            <div>
                              <div>Convert to USDC</div>
                              <div className="text-xs text-muted-foreground">
                                {chainLabel(c.payout_chain)}
                                {c.payout_address ? `, ${truncateMiddle(c.payout_address, 6, 4)}` : ""}
                              </div>
                            </div>
                          )}
                        </TableCell>
                        <TableCell>
                          {c.fvk_shared_at ? (
                            <Badge tone="success" title={`Marked as shared on ${formatDate(c.fvk_shared_at)}`}>
                              Shared {formatDate(c.fvk_shared_at)}
                            </Badge>
                          ) : (
                            <Badge tone="warning">Not shared</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="inline-flex items-center gap-1">
                            <Button variant="outline" size="sm" onClick={() => setSharing(c)}>
                              <KeyRound aria-hidden="true" />
                              Share viewing key
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setEditing(c)}
                              aria-label={`Edit ${c.name}`}
                              title="Edit"
                            >
                              <Pencil aria-hidden="true" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => setArchiving(c)}
                              aria-label={`Archive ${c.name}`}
                              title="Archive"
                            >
                              <Archive aria-hidden="true" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </Panel>
      )}

      <ContractorFormDialog open={adding} onOpenChange={setAdding} onSaved={upsert} />
      <ContractorFormDialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        contractor={editing ?? undefined}
        onSaved={upsert}
      />
      {sharing ? (
        <ShareKeyDialog
          contractor={sharing}
          open={!!sharing}
          onOpenChange={(o) => !o && setSharing(null)}
          onShared={(c) => {
            upsert(c);
            setSharing(null);
          }}
        />
      ) : null}
      <ExportKeysDialog open={exporting} onOpenChange={setExporting} />
      <ArchiveDialog
        contractor={archiving}
        onClose={() => setArchiving(null)}
        onArchived={(id) => contractors.setData((prev) => (prev ?? []).filter((c) => c.id !== id))}
      />
    </div>
  );
}

function ArchiveDialog({
  contractor,
  onClose,
  onArchived,
}: {
  contractor: Contractor | null;
  onClose: () => void;
  onArchived: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    if (!contractor) return;
    setBusy(true);
    setError(null);
    try {
      await api.archiveContractor(contractor.id);
      toast.success(`Archived ${contractor.name}`);
      onArchived(contractor.id);
      onClose();
    } catch (err) {
      const e = toDisplayError(err);
      setError(e.hint ? `${e.message} ${e.hint}` : e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={!!contractor}
      onOpenChange={(o) => {
        if (!o) {
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Archive {contractor?.name}?</DialogTitle>
          <DialogDescription>
            They will no longer appear in new runs. Past payments stay on chain and in statements, and their viewing key
            keeps working.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="rounded-md bg-danger-bg p-3 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={busy}>
            {busy ? "Archiving" : "Archive contractor"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
