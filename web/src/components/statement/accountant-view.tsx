"use client";

import { useMemo, useState } from "react";
import { Scale } from "lucide-react";
import { Usd, Zec, Rate } from "@/components/app/amount";
import { useHealth } from "@/components/app/health-provider";
import { Hash } from "@/components/app/hash";
import { EmptyState, ErrorState, PageHeader, Panel, Stat, TableSkeleton } from "@/components/app/states";
import { ReconStatusBadge } from "@/components/app/status-badge";
import { collectKeys, KeyCollection, readyKeys, type CollectedKey } from "@/components/statement/key-collection";
import { PeriodPicker } from "@/components/statement/period-picker";
import { StatementActions } from "@/components/statement/statement-actions";
import { StatementLinesTable, UnlabelledTable } from "@/components/statement/statement-tables";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api, toDisplayError, type ApiError, type Reconciliation } from "@/lib/api";
import { formatCount, formatDateTime, formatHeight, formatPeriodLabel, formatRange, networkLabel } from "@/lib/format";
import { isValidRange, yearToDate } from "@/lib/period";
import { cn } from "cn";

export function AccountantView() {
  const { health } = useHealth();
  const [pasted, setPasted] = useState("");
  const [extra, setExtra] = useState<CollectedKey[]>([]);
  const [period, setPeriod] = useState(yearToDate);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<Reconciliation | null>(null);
  const [request, setRequest] = useState<{ ufvks: string[]; from: string; to: string } | null>(null);

  const keys = collectKeys(pasted, extra);
  const ufvks = readyKeys(keys, health?.network);
  const rejected = keys.length - ufvks.length;
  const canSubmit = ufvks.length > 0 && isValidRange(period.from, period.to) && !loading;

  const load = async () => {
    if (!canSubmit) return;
    // Only viewing keys and the period leave the browser. Labels stay here.
    const body = { ufvks, from: period.from, to: period.to };
    setLoading(true);
    setError(null);
    try {
      setResult(await api.accountantStatement(body));
      setRequest(body);
    } catch (err) {
      setError(toDisplayError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div data-print="hide">
        <PageHeader
          title="Reconciliation"
          description="Load the payer's viewing keys to see every run and every line, funded USD against paid USD, with the variance explained. Viewing keys cannot spend."
        />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
        noValidate
        data-print="hide"
      >
        <Panel>
          <div className="grid gap-6 p-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <KeyCollection
              pasted={pasted}
              onPastedChange={setPasted}
              extra={extra}
              onExtraChange={setExtra}
              serviceNetwork={health?.network}
            />
            <div className="space-y-4">
              <PeriodPicker idPrefix="accountant-period" from={period.from} to={period.to} onChange={setPeriod} />
              <Button type="submit" disabled={!canSubmit} className="w-full sm:w-auto">
                {loading
                  ? "Scanning the chain with these keys"
                  : `Reconcile ${ufvks.length} ${ufvks.length === 1 ? "key" : "keys"}`}
              </Button>
              {rejected > 0 ? (
                <p className="text-xs text-muted-foreground">
                  {rejected} {rejected === 1 ? "entry is" : "entries are"} not usable and will not be sent. Remove or
                  fix {rejected === 1 ? "it" : "them"} in the list.
                </p>
              ) : null}
            </div>
          </div>
        </Panel>
      </form>

      {loading ? (
        <Panel
          title="Scanning the chain with these keys"
          description="The first scan of a key set takes a few seconds while the service builds a view-only wallet for it. Later scans are incremental."
        >
          <TableSkeleton label="Scanning the chain with these keys" rows={4} columns={8} />
        </Panel>
      ) : error ? (
        <ErrorState error={error} onRetry={() => void load()} />
      ) : result && request ? (
        <ReconciliationView data={result} request={request} />
      ) : (
        <div data-print="hide">
          <Panel>
            <EmptyState icon={<Scale />} title="The reconciliation appears here">
              Import the payer&apos;s viewing key file or paste the keys, choose a period and select Reconcile. Each run
              shows funded USD, ZEC acquired, what was paid and whether the difference is explained by fees and unspent
              ZEC.
            </EmptyState>
          </Panel>
        </div>
      )}
    </div>
  );
}

function ReconciliationView({
  data: r,
  request,
}: {
  data: Reconciliation;
  request: { ufvks: string[]; from: string; to: string };
}) {
  const [contractor, setContractor] = useState("all");
  const contractors = useMemo(() => {
    const names = new Map<string, string>();
    for (const l of r.lines) {
      const key = l.account_index !== null ? `acct-${l.account_index}` : `label-${l.label ?? "unknown"}`;
      names.set(key, l.label ?? (l.account_index !== null ? `Account ${l.account_index}` : "Unknown account"));
    }
    return [...names.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [r.lines]);
  const lines =
    contractor === "all"
      ? r.lines
      : r.lines.filter(
          (l) =>
            (l.account_index !== null ? `acct-${l.account_index}` : `label-${l.label ?? "unknown"}`) === contractor,
        );
  const unknownAccounts = r.accounts.filter((a) => a.role === "unknown").length;
  const filename = `payslip-reconciliation-${r.period.from}-to-${r.period.to}.csv`;

  return (
    <article className="space-y-6" aria-labelledby="recon-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <p className="hidden text-sm font-semibold print:block">Payslip</p>
          <h2 id="recon-title" className="text-xl font-semibold tracking-tight">
            Reconciliation, {formatRange(r.period.from, r.period.to)}
          </h2>
          <p className="text-sm text-muted-foreground">
            {r.accounts.length} {r.accounts.length === 1 ? "account" : "accounts"} on Zcash{" "}
            {networkLabel(r.network).toLowerCase()}, scanned to height{" "}
            <span className="num">{formatHeight(r.scanned_to_height)}</span>. Generated {formatDateTime(r.generated_at)}
            .
          </p>
          {unknownAccounts > 0 ? (
            <p className="text-sm text-warning">
              {unknownAccounts} {unknownAccounts === 1 ? "key does" : "keys do"} not match an account this service
              knows. Their payments are listed but cannot be joined to runs.
            </p>
          ) : null}
        </div>
        <StatementActions fetchCsv={() => api.accountantStatementCsv(request)} filename={filename} />
      </div>

      {r.treasury_key_present === false ? (
        <div role="status" className="rounded-lg border border-warning/40 bg-warning-bg p-4 text-sm">
          <p className="font-medium">The Treasury viewing key is not loaded</p>
          <p className="mt-1 text-muted-foreground">
            Funded USD, ZEC acquired and the fill rate live in the treasury account, so without its key they cannot be
            read and funding cannot be reconciled. Add the key labelled Treasury from the payer&apos;s export file and
            reconcile again.
          </p>
        </div>
      ) : null}

      <dl className="grid grid-cols-2 gap-6 rounded-lg border bg-card p-4 lg:grid-cols-5" data-print="plain">
        <Stat label="Funded">
          <Usd cents={r.totals.funded_usd_cents} />
        </Stat>
        <Stat label="Paid">
          <Usd cents={r.totals.paid_usd_cents} />
        </Stat>
        <Stat label="Variance" hint="Funded minus paid">
          <Usd cents={r.totals.variance_usd_cents} />
        </Stat>
        <Stat label="Paid in ZEC">
          <Zec zat={r.totals.paid_zat} />
        </Stat>
        <Stat label="Pay lines">
          <span className="num">{formatCount(r.totals.count)}</span>
        </Stat>
      </dl>

      <Panel
        title="Runs"
        description="Variance is funded USD minus paid USD. Explained is the ZEC acquired but not paid out (network fees plus unspent), valued at the run's fill rate. A run is reconciled when the two agree to the cent."
      >
        {r.runs.length === 0 ? (
          <EmptyState title="No runs in this period">
            Runs appear when payments made with these keys fall inside the period. Include the treasury key to see
            funding.
          </EmptyState>
        ) : (
          <Table label="Run reconciliation" minWidth={1260}>
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Status</TableHead>
                <TableHead numeric>Funded USD</TableHead>
                <TableHead numeric>ZEC acquired</TableHead>
                <TableHead numeric>{r.network === "testnet" ? "Testnet fixed rate" : "Fill rate"}</TableHead>
                <TableHead numeric>Paid USD</TableHead>
                <TableHead numeric>Paid ZEC</TableHead>
                <TableHead numeric>Network fees</TableHead>
                <TableHead numeric>Unspent</TableHead>
                <TableHead numeric>Variance</TableHead>
                <TableHead numeric>Explained</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.runs.map((run) => (
                <TableRow key={run.run_id}>
                  <TableCell>
                    <div className="font-medium">{formatPeriodLabel(run.period)}</div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      {run.lines} {run.lines === 1 ? "line" : "lines"}
                      {run.pending_lines ? `, ${run.pending_lines} pending` : ""},{" "}
                      <Hash value={run.run_id} label="run id" head={6} tail={4} />
                    </div>
                  </TableCell>
                  <TableCell>
                    <ReconStatusBadge status={run.status} />
                  </TableCell>
                  <TableCell numeric>
                    <Usd cents={run.funded_usd_cents} />
                  </TableCell>
                  <TableCell numeric>
                    <Zec zat={run.zec_acquired_zat} unit={false} />
                  </TableCell>
                  <TableCell numeric>
                    <Rate e6={run.rate_usd_per_zec_e6} unit={false} />
                  </TableCell>
                  <TableCell numeric>
                    <Usd cents={run.paid_usd_cents} />
                  </TableCell>
                  <TableCell numeric>
                    <Zec zat={run.paid_zat} unit={false} />
                  </TableCell>
                  <TableCell numeric>
                    <Zec zat={run.network_fees_zat} unit={false} />
                  </TableCell>
                  <TableCell numeric>
                    <Zec zat={run.unspent_zat} unit={false} />
                  </TableCell>
                  <TableCell
                    numeric
                    className={cn(run.status === "variance_unexplained" && "font-semibold text-danger")}
                  >
                    <Usd cents={run.variance_usd_cents} />
                  </TableCell>
                  <TableCell numeric>
                    <Usd cents={run.explained_usd_cents} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow className="hover:bg-transparent">
                <TableCell>Total</TableCell>
                <TableCell />
                <TableCell numeric>
                  <Usd cents={r.totals.funded_usd_cents} />
                </TableCell>
                <TableCell colSpan={2} />
                <TableCell numeric>
                  <Usd cents={r.totals.paid_usd_cents} />
                </TableCell>
                <TableCell numeric>
                  <Zec zat={r.totals.paid_zat} unit={false} />
                </TableCell>
                <TableCell colSpan={2} />
                <TableCell numeric>
                  <Usd cents={r.totals.variance_usd_cents} />
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </Panel>

      <Panel
        title="Pay lines"
        description="Every payment across the accounts, joined to its run through the memo."
        actions={
          contractors.length > 1 ? (
            <div className="flex items-center gap-2">
              <Label htmlFor="contractor-filter" className="text-xs font-normal text-muted-foreground">
                Contractor
              </Label>
              <NativeSelect
                id="contractor-filter"
                value={contractor}
                onChange={(e) => setContractor(e.target.value)}
                className="h-8 w-48"
              >
                <option value="all">All contractors</option>
                {contractors.map(([key, name]) => (
                  <option key={key} value={key}>
                    {name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null
        }
      >
        {lines.length === 0 ? (
          <EmptyState title="No pay lines in this period">
            Widen the period or check that every contractor key is loaded.
          </EmptyState>
        ) : (
          <StatementLinesTable lines={lines} label="Pay lines" showContractor showRunning={false} showRate={false} />
        )}
      </Panel>

      {r.pending && r.pending.length > 0 ? (
        <Panel title="Pending" description="Sent but not mined yet. Not included in the totals above.">
          <StatementLinesTable
            lines={r.pending}
            label="Pending pay lines"
            showContractor
            showRunning={false}
            showRate={false}
          />
        </Panel>
      ) : null}

      <Panel
        title="Unlabelled"
        description="Transactions without a Payslip memo. Listed so nothing is dropped; they are not in the totals."
      >
        {r.unlabelled.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">No unlabelled transactions in this period.</p>
        ) : (
          <UnlabelledTable lines={r.unlabelled} label="Unlabelled transactions" />
        )}
      </Panel>
    </article>
  );
}
