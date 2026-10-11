"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, FileSpreadsheet, Printer } from "lucide-react";
import { toast } from "sonner";
import { Fiat, Usd, Zec } from "@/components/app/amount";
import { useHealth } from "@/components/app/health-provider";
import { ErrorState } from "@/components/app/states";
import { Card } from "@/components/ds/card";
import { PageTitle, SectionHeader } from "@/components/ds/page";
import {
  CURRENCIES,
  csvName,
  fetchStatement,
  lastYear,
  monthDay,
  newestFirst,
  payslipHref,
  retryOnce,
  statementRequest,
  type StatementRequest,
} from "@/components/portal/portal-data";
import { usePersonName, usePortal, usePortalKey } from "@/components/portal/portal-provider";
import { RowsSkeleton, ScanProgress, SimulatedRate } from "@/components/portal/portal-states";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import {
  api,
  toDisplayError,
  type ApiError,
  type ContractorExportFormat,
  type Statement,
  type StatementLine,
} from "@/lib/api";
import { saveBlob } from "@/lib/download";
import {
  formatDateTime,
  formatHeight,
  formatPeriodLabel,
  formatRange,
  networkLabel,
  truncateMiddle,
} from "@/lib/format";
import { isValidRange, lastNDays, previousMonth, yearToDate } from "@/lib/period";
import { cn } from "cn";
import { TYPE } from "@/components/ds/type";

const PRESETS = [
  { id: "ytd", label: "Year to date", range: () => yearToDate() },
  { id: "last-year", label: "Last year", range: () => lastYear() },
  { id: "last-month", label: "Last month", range: () => previousMonth() },
  { id: "90d", label: "Last 90 days", range: () => lastNDays(90) },
] as const;

type PresetId = (typeof PRESETS)[number]["id"] | "custom";

const FORMATS: { value: ContractorExportFormat; label: string; hint: string }[] = [
  { value: "payslip", label: "Payslip CSV", hint: "Every field, unlabelled lines included" },
  { value: "koinly", label: "Koinly CSV", hint: "Koinly's universal import" },
  { value: "cointracker", label: "CoinTracker CSV", hint: "CoinTracker's import" },
];

interface Loaded {
  statement?: Statement;
  error?: ApiError;
  loading: boolean;
  startedAt?: number;
}

/** A statement for any period, with the downloads a tax return or an accounting tool needs. */
export function TaxDocuments() {
  const ufvk = usePortalKey();
  const { currency, setCurrency, meta } = usePortal();
  const { health } = useHealth();
  const [preset, setPreset] = useState<PresetId>("ytd");
  const [range, setRange] = useState(() => yearToDate());
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Loaded>({ loading: true });
  // Value at receipt is shown on mainnet only: testnet coins have no market price (ADR-022).
  const showCurrency = health?.network === "mainnet" && health.market_prices !== false;
  const valid = withinAYear(range.from, range.to);

  const request = useMemo<StatementRequest>(
    () => statementRequest(ufvk, range, meta, showCurrency ? currency : undefined),
    [ufvk, range, meta, showCurrency, currency],
  );

  useEffect(() => {
    if (!valid) {
      // A range that turns invalid mid-load stops the progress line; the request is dropped.
      setState((s) => ({ ...s, loading: false }));
      return;
    }
    const ctrl = new AbortController();
    setState((s) => ({ statement: s.statement, loading: true, startedAt: Date.now() }));
    fetchStatement(request, ctrl.signal)
      .then((statement) => !ctrl.signal.aborted && setState({ statement, loading: false }))
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        setState((s) => ({ statement: s.statement, error: toDisplayError(err), loading: false }));
      });
    return () => ctrl.abort();
  }, [request, valid, attempt]);

  const s = state.statement;
  const current = s && s.period.from === range.from && s.period.to === range.to ? s : undefined;
  const name = usePersonName();

  const download = async (format: ContractorExportFormat) => {
    try {
      // One retry when the service's lightwalletd connection had dropped, as for the statement.
      const res = await retryOnce(() => api.contractorStatementCsv(request, format));
      // A service that knows no names files the statement under a fingerprint; use the name we have.
      const named = name && !s?.account.label ? csvName(format, name, range.from, range.to) : null;
      saveBlob(res.blob, named ?? res.filename ?? csvName(format, name, range.from, range.to));
      toast.success(`${FORMATS.find((f) => f.value === format)?.label ?? "CSV"} downloaded`);
    } catch (err) {
      const e = toDisplayError(err);
      toast.error(e.message, { description: e.hint });
    }
  };

  const print = () => {
    const previous = document.title;
    document.title = `Payment statement${name ? `, ${name}` : ""}, ${range.from} to ${range.to}`;
    window.print();
    document.title = previous;
  };

  return (
    <>
      <div data-print="hide">
        <PageTitle
          title="Tax documents"
          description="Every payment to you in a period, with the USD amount agreed for each."
        />
      </div>
      <div className="hidden print:block">
        <h1 className={TYPE.title}>Payment statement{name ? ` for ${name}` : ""}</h1>
        {s ? (
          <p className="mt-1 text-[0.8125rem]">
            {formatRange(s.period.from, s.period.to)}. Zcash {networkLabel(s.network).toLowerCase()}, scanned to block{" "}
            {formatHeight(s.scanned_to_height)}. Generated {formatDateTime(s.generated_at)}.
          </p>
        ) : null}
      </div>

      <div className="mb-6 flex flex-wrap items-end gap-x-4 gap-y-3" data-print="hide">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Period">
          {PRESETS.map((p) => (
            <Chip
              key={p.id}
              active={preset === p.id}
              onClick={() => {
                setPreset(p.id);
                setRange(p.range());
              }}
            >
              {p.label}
            </Chip>
          ))}
          <Chip active={preset === "custom"} onClick={() => setPreset("custom")}>
            Custom
          </Chip>
        </div>
        <div className="flex items-end gap-2 sm:ml-auto">
          {showCurrency ? (
            <div className="space-y-1">
              <label htmlFor="tax-currency" className="block text-[0.8125rem] text-muted-foreground">
                Value at receipt in
              </label>
              <NativeSelect
                id="tax-currency"
                value={currency.toUpperCase()}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-28"
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
          <DownloadMenu disabled={!current} onCsv={download} onPrint={print} />
        </div>
      </div>

      {preset === "custom" ? (
        <div className="-mt-2 mb-6 flex flex-wrap items-end gap-3" data-print="hide">
          <DateField
            id="tax-from"
            label="From"
            value={range.from}
            onChange={(from) => setRange((r) => ({ ...r, from }))}
            invalid={!valid}
          />
          <DateField
            id="tax-to"
            label="To"
            value={range.to}
            onChange={(to) => setRange((r) => ({ ...r, to }))}
            invalid={!valid}
          />
        </div>
      ) : null}
      <p
        className={cn("mb-5 text-[0.8125rem]", valid ? "text-muted-foreground" : "text-destructive")}
        data-print="hide"
      >
        {valid
          ? `${formatRange(range.from, range.to)}, in UTC. A payment counts on the day its block was mined.`
          : "The period must start on or before the day it ends, and cover at most a year."}
      </p>

      {state.error ? (
        <ErrorState error={state.error} onRetry={() => setAttempt((n) => n + 1)} className="mb-5" />
      ) : null}
      {state.loading ? (
        <div className="mb-5">
          <ScanProgress startedAt={state.startedAt} title="Reading payments to you in this period" />
        </div>
      ) : null}

      {current ? (
        <StatementBody statement={current} currency={showCurrency ? currency.toUpperCase() : null} range={range} />
      ) : !state.error && valid ? (
        <RowsSkeleton rows={3} />
      ) : null}
    </>
  );
}

/** A statement covers at most a year (the service's limit). */
function withinAYear(from: string, to: string): boolean {
  if (!isValidRange(from, to)) return false;
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 <= 366;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center rounded-lg border px-3 text-[0.8125rem] text-strong transition-colors hover:bg-muted",
        active && "border-transparent bg-chip text-foreground hover:bg-chip",
      )}
    >
      {children}
    </button>
  );
}

function DateField({
  id,
  label,
  value,
  onChange,
  invalid,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-[0.8125rem] text-muted-foreground">
        {label}
      </label>
      <Input
        id={id}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid}
        className="w-40"
      />
    </div>
  );
}

function DownloadMenu({
  disabled,
  onCsv,
  onPrint,
}: {
  disabled: boolean;
  onCsv: (format: ContractorExportFormat) => void;
  onPrint: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button>
          Download
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Download this statement</DropdownMenuLabel>
        {FORMATS.map((f) => (
          <DropdownMenuItem key={f.value} onSelect={() => onCsv(f.value)}>
            <FileSpreadsheet aria-hidden="true" />
            <span className="grid">
              <span className="text-foreground">{f.label}</span>
              <span className="text-[0.8125rem] text-muted-foreground">{f.hint}</span>
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onPrint}>
          <Printer aria-hidden="true" />
          <span className="grid">
            <span className="text-foreground">PDF</span>
            <span className="text-[0.8125rem] text-muted-foreground">Print or save as PDF</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StatementBody({
  statement: s,
  currency,
  range,
}: {
  statement: Statement;
  currency: string | null;
  range: { from: string; to: string };
}) {
  const lines = newestFirst(s.lines);
  const market = currency && s.market?.available ? s.market : null;
  const testnet = s.network === "testnet";
  return (
    <>
      <Card className="mb-8 print:mt-5" aria-label="Totals" data-print="plain">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <Figure label="Payments">
            <span className="num">{s.totals.count}</span>
          </Figure>
          <Figure label="Agreed in USD">
            <Usd cents={s.totals.usd_cents} />
          </Figure>
          <Figure label="Received">
            <Zec zat={s.totals.zat} short />
            {testnet ? <SimulatedRate className="mt-0.5 block" /> : null}
          </Figure>
          {market ? (
            <Figure label={`Value at receipt (${market.currency})`}>
              <Fiat cents={market.total_cents ?? 0} currency={market.currency} />
            </Figure>
          ) : (
            <Figure label="Scanned to block">
              <span className="num">{formatHeight(s.scanned_to_height)}</span>
            </Figure>
          )}
        </dl>
        {market?.unpriced_lines ? (
          <p className="mt-3 text-[0.8125rem] text-muted-foreground">
            {market.unpriced_lines} {market.unpriced_lines === 1 ? "payment has" : "payments have"} no price point near
            its block time, so {market.unpriced_lines === 1 ? "it is" : "they are"} not in this total.
          </p>
        ) : null}
        {currency && s.market && !s.market.available ? (
          <p className="mt-3 text-[0.8125rem] text-muted-foreground">
            {s.market.error ?? "Market prices are unavailable right now."}
          </p>
        ) : null}
      </Card>

      {lines.length === 0 ? (
        <p className="border-y border-hairline py-6 text-[0.9375rem] text-muted-foreground">
          No payments in this period. A September invoice paid in October counts in October.
        </p>
      ) : (
        <LinesTable lines={lines} currency={market ? market.currency : null} range={range} />
      )}

      {s.pending.length > 0 ? (
        <>
          <SectionHeader title="Waiting to be mined" />
          <p className="mb-3 text-[0.8125rem] text-muted-foreground">
            Sent but not yet in a block, so not in the totals above.
          </p>
          <LinesTable lines={newestFirst(s.pending)} currency={null} range={range} pending />
        </>
      ) : null}

      {s.unlabelled.length > 0 ? (
        <>
          <SectionHeader title="Other transactions" />
          <p className="mb-3 text-[0.8125rem] text-muted-foreground">
            Transactions on this key without a Payslip memo. Listed so nothing is hidden; not in the totals.
          </p>
          <table className="w-full text-[0.9375rem]">
            <thead>
              <tr className="border-b border-hairline text-left text-[0.8125rem] text-muted-foreground">
                <th scope="col" className="py-2.5 pr-3 font-normal">
                  Date
                </th>
                <th scope="col" className="py-2.5 pr-3 font-normal">
                  Memo
                </th>
                <th scope="col" className="py-2.5 text-right font-normal">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {s.unlabelled.map((u) => (
                <tr key={`${u.txid}-${u.direction}-${u.amount_zat}`} className="h-[50px] border-b border-hairline">
                  <td className="pr-3 whitespace-nowrap">{monthDay(u.date)}</td>
                  <td className="max-w-0 truncate pr-3 text-muted-foreground">
                    {u.memo_text ?? (u.reason === "no_memo" ? "No memo" : "A memo Payslip does not read")}
                  </td>
                  <td className="text-right">
                    {u.direction === "out" ? "Sent " : "Received "}
                    <Zec zat={u.amount_zat} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </>
  );
}

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.8125rem] text-muted-foreground">{label}</dt>
      <dd className={cn(TYPE.heading, "mt-1")}>{children}</dd>
    </div>
  );
}

function LinesTable({
  lines,
  currency,
  range,
  pending,
}: {
  lines: StatementLine[];
  currency: string | null;
  /** The statement's period, carried to the payslip so it can open a payment from any year. */
  range: { from: string; to: string };
  pending?: boolean;
}) {
  return (
    <div className="overflow-x-auto" data-print-scroll="">
      <table className="w-full text-[0.9375rem]">
        <thead>
          <tr className="border-b border-hairline text-left text-[0.8125rem] text-muted-foreground">
            <th scope="col" className="py-2.5 pr-3 font-normal">
              Date
            </th>
            <th scope="col" className="py-2.5 pr-3 font-normal">
              Payslip
            </th>
            <th scope="col" className="hidden py-2.5 pr-3 font-normal md:table-cell print:table-cell">
              Transaction
            </th>
            {currency ? (
              <th scope="col" className="hidden py-2.5 pr-3 text-right font-normal sm:table-cell print:table-cell">
                At receipt
              </th>
            ) : null}
            <th scope="col" className="py-2.5 text-right font-normal">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={`${l.txid}-${l.amount_zat}`} className="h-[54px] border-b border-hairline align-middle">
              <td className="pr-3 whitespace-nowrap">{pending ? "Pending" : monthDay(l.block_time ?? l.date)}</td>
              <td className="max-w-0 pr-3 sm:max-w-none">
                <Link href={payslipHref(l, range)} className="block truncate rounded-sm hover:underline">
                  {formatPeriodLabel(l.period)}
                </Link>
                <span className="block truncate text-[0.8125rem] text-muted-foreground">
                  {l.invoice_ref}
                  {l.settlement === "converted" ? ", converted to USDC" : ""}
                </span>
              </td>
              <td className="hidden pr-3 md:table-cell print:table-cell">
                <code className="font-mono text-[0.8125rem] text-muted-foreground" title={l.txid}>
                  <span data-print="hide">{truncateMiddle(l.txid, 8, 6)}</span>
                  <span data-print="only" className="break-all">
                    {l.txid}
                  </span>
                </code>
                {l.height !== null ? (
                  <span className="block text-[0.8125rem] text-muted-foreground">
                    Block <span className="num">{formatHeight(l.height)}</span>
                  </span>
                ) : null}
              </td>
              {currency ? (
                <td className="hidden pr-3 text-right sm:table-cell print:table-cell">
                  {l.market ? (
                    <Fiat cents={l.market.value_cents} currency={l.market.currency} />
                  ) : (
                    <span className="text-muted-foreground">No price</span>
                  )}
                </td>
              ) : null}
              <td className="text-right">
                <Usd cents={l.usd_basis_cents} />
                <span className="block text-[0.8125rem] text-muted-foreground">
                  <Zec zat={l.amount_zat} short />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
