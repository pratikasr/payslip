"use client";

import { useState } from "react";
import { Inbox, ScanLine } from "lucide-react";
import { Usd, Zec } from "@/components/app/amount";
import { useHealth } from "@/components/app/health-provider";
import { Hash } from "@/components/app/hash";
import { EmptyState, ErrorState, PageHeader, Panel, Stat, TableSkeleton } from "@/components/app/states";
import { KeyStatus } from "@/components/keys/key-status";
import { ScanDialog } from "@/components/keys/scan-dialog";
import { PeriodPicker } from "@/components/statement/period-picker";
import { StatementActions } from "@/components/statement/statement-actions";
import { FundingTable, StatementLinesTable, UnlabelledTable } from "@/components/statement/statement-tables";
import { ProveDialog } from "@/components/proof/prove-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { api, toDisplayError, type ApiError, type Statement, type StatementLine } from "@/lib/api";
import { classifyKey } from "@/lib/keys";
import { formatCount, formatDateTime, formatFiat, formatHeight, formatRange, networkLabel } from "@/lib/format";

/** Currencies the service prices ZEC in (CoinGecko's fiat list), most used first. */
const CURRENCIES = (
  "USD EUR GBP INR CAD AUD NGN BRL MXN SGD PHP ZAR JPY CHF AED ARS BDT BHD CLP CNY CZK DKK " +
  "GEL HKD HUF IDR ILS KRW KWD LKR MMK MYR NOK NZD PKR PLN RUB SAR SEK THB TRY TWD UAH VND"
).split(" ");

const EXPORT_FORMATS = [
  { value: "payslip", label: "Payslip CSV" },
  { value: "koinly", label: "Koinly CSV" },
  { value: "cointracker", label: "CoinTracker CSV" },
];

type StatementRequest = { ufvk: string; from: string; to: string; currency?: string };
import { isValidRange, yearToDate } from "@/lib/period";

export function ContractorStatementView() {
  const { health } = useHealth();
  const [raw, setRaw] = useState("");
  const [touched, setTouched] = useState(false);
  const [period, setPeriod] = useState(yearToDate);
  const [scanOpen, setScanOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [request, setRequest] = useState<StatementRequest | null>(null);
  const [currency, setCurrency] = useState("USD");
  // Market value at receipt is shown on mainnet only: testnet coins have no market price (ADR-022).
  const showCurrency = health?.network === "mainnet" && health.market_prices !== false;

  const result = classifyKey(raw);
  const networkMismatch = result.kind === "ufvk" && !!health && result.network !== health.network;
  const canSubmit = result.kind === "ufvk" && !networkMismatch && isValidRange(period.from, period.to) && !loading;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    void load();
  };

  const load = async () => {
    if (result.kind !== "ufvk" || !canSubmit) return;
    const body: StatementRequest = {
      ufvk: result.value,
      from: period.from,
      to: period.to,
      ...(showCurrency ? { currency } : {}),
    };
    setLoading(true);
    setError(null);
    try {
      setStatement(await api.contractorStatement(body));
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
          title="Your payment statement"
          description="Paste the viewing key your payer shared with you. It shows the payments to you, with the USD value recorded at the time of each payment. A viewing key cannot spend."
        />
      </div>

      <form onSubmit={submit} noValidate data-print="hide">
        <Panel>
          <div className="grid gap-6 p-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <div className="space-y-2">
              <div className="flex items-end justify-between gap-2">
                <Label htmlFor="ufvk">Viewing key</Label>
                <Button type="button" variant="ghost" size="sm" onClick={() => setScanOpen(true)}>
                  <ScanLine aria-hidden="true" />
                  Scan QR code
                </Button>
              </div>
              <Textarea
                id="ufvk"
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                onBlur={() => setTouched(true)}
                rows={5}
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="off"
                className="font-mono text-xs break-all"
                aria-invalid={touched && raw.trim() !== "" && (result.kind !== "ufvk" || networkMismatch)}
                aria-describedby="ufvk-status"
              />
              {touched && raw.trim() !== "" ? (
                <KeyStatus result={result} serviceNetwork={health?.network} id="ufvk-status" />
              ) : (
                <p id="ufvk-status" className="text-xs text-muted-foreground">
                  Starts with uview or uvf on mainnet, uviewtest or uvftest on testnet. It stays in this tab and is sent
                  only to the Payslip service to scan.
                </p>
              )}
            </div>
            <div className="space-y-4">
              <PeriodPicker idPrefix="contractor-period" from={period.from} to={period.to} onChange={setPeriod} />
              {showCurrency ? (
                <div className="space-y-1.5">
                  <Label htmlFor="statement-currency">Value at receipt in</Label>
                  <NativeSelect
                    id="statement-currency"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    className="sm:w-40"
                    aria-describedby="statement-currency-help"
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </NativeSelect>
                  <p id="statement-currency-help" className="text-xs text-muted-foreground">
                    What each payment was worth when it arrived, for your tax return.
                  </p>
                </div>
              ) : null}
              <Button type="submit" disabled={!canSubmit} className="w-full sm:w-auto">
                {loading ? "Scanning the chain with your key" : "Show statement"}
              </Button>
            </div>
          </div>
        </Panel>
      </form>

      <ScanDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        onResult={(v) => {
          setRaw(v.trim());
          setTouched(true);
        }}
      />

      {loading ? (
        <Panel
          title="Scanning the chain with your key"
          description="The first scan of a key takes a few seconds while the service builds a view-only wallet for it. Later scans pick up where the last one stopped."
        >
          <TableSkeleton label="Scanning the chain with your key" rows={4} columns={7} />
        </Panel>
      ) : error ? (
        <ErrorState error={error} onRetry={() => void load()} />
      ) : statement && request ? (
        <StatementView statement={statement} request={request} />
      ) : (
        <div data-print="hide">
          <Panel>
            <EmptyState icon={<Inbox />} title="Your statement appears here">
              Paste or scan your viewing key, choose a period and select Show statement. You get every payment with its
              date, ZEC amount, USD basis, invoice reference and transaction id.
            </EmptyState>
          </Panel>
        </div>
      )}
    </div>
  );
}

function StatementView({ statement: s, request }: { statement: Statement; request: StatementRequest }) {
  const [proving, setProving] = useState<StatementLine | null>(null);
  const showMarket = s.network === "mainnet" && !!s.market?.available;
  const who = s.account.label ?? `Account ${s.account.fingerprint.slice(0, 12)}`;
  const filename = `payslip-statement-${who.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${s.period.from}-to-${s.period.to}.csv`;
  return (
    <article className="space-y-6" aria-labelledby="statement-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <p className="hidden text-sm font-semibold print:block">Payslip</p>
          <h2 id="statement-title" className="text-xl font-semibold tracking-tight">
            Payment statement for {who}
          </h2>
          <p className="text-sm text-muted-foreground">
            {formatRange(s.period.from, s.period.to)}. Zcash {networkLabel(s.network).toLowerCase()}, scanned to height{" "}
            <span className="num">{formatHeight(s.scanned_to_height)}</span>. Generated {formatDateTime(s.generated_at)}
            .
          </p>
          <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            Account fingerprint <Hash value={s.account.fingerprint} label="account fingerprint" head={10} tail={6} />
          </p>
        </div>
        <StatementActions
          fetchCsv={(format) =>
            api.contractorStatementCsv(request, (format ?? "payslip") as "payslip" | "koinly" | "cointracker")
          }
          filename={filename}
          formats={EXPORT_FORMATS}
        />
      </div>

      <dl
        className="grid grid-cols-1 gap-6 rounded-lg border bg-card p-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)_minmax(0,0.6fr)]"
        data-print="plain"
      >
        <Stat size="lg" label="Total USD basis">
          <Usd cents={s.totals.usd_cents} />
        </Stat>
        <Stat size="lg" label="Total received">
          <Zec zat={s.totals.zat} />
        </Stat>
        <Stat size="lg" label="Payments">
          <span className="num">{formatCount(s.totals.count)}</span>
        </Stat>
      </dl>
      {showMarket && s.market ? (
        <p className="text-sm text-muted-foreground">
          Worth {formatFiat(s.market.total_cents ?? 0, s.market.currency)} at market prices when received
          {s.market.unpriced_lines ? `, ${s.market.unpriced_lines} payments without a price` : ""}. Source: CoinGecko,
          the ZEC price nearest each payment&apos;s block time.
        </p>
      ) : s.network === "mainnet" && s.market && !s.market.available ? (
        <p className="text-sm text-muted-foreground">{s.market.error}</p>
      ) : null}

      <Panel
        title="Payments"
        description={
          s.network === "testnet"
            ? "USD basis uses the testnet fixed rate of the run that paid you. Testnet coins have no market price, so the testnet venue fixes the rate."
            : "USD basis is the swap fill rate of the run that paid you, not a market price."
        }
      >
        {s.lines.length === 0 ? (
          <EmptyState title="No payments in this period">
            Try a wider period. Payments count on the day their block was mined, so a September invoice paid in October
            appears in October.
          </EmptyState>
        ) : (
          <StatementLinesTable
            lines={s.lines}
            label="Payments"
            testnet={s.network === "testnet"}
            showMarket={showMarket}
            onProve={setProving}
          />
        )}
      </Panel>

      {s.pending.length > 0 ? (
        <Panel title="Pending" description="Sent but not mined yet. Not included in the totals above.">
          <StatementLinesTable
            lines={s.pending}
            label="Pending payments"
            showRunning={false}
            testnet={s.network === "testnet"}
          />
        </Panel>
      ) : null}

      <Panel
        title="Unlabelled"
        description="Transactions on this account without a Payslip memo. Listed so nothing is hidden; they are not in the totals."
      >
        {s.unlabelled.length === 0 ? (
          <p className="px-4 py-4 text-sm text-muted-foreground">No unlabelled transactions in this period.</p>
        ) : (
          <UnlabelledTable lines={s.unlabelled} label="Unlabelled transactions" />
        )}
      </Panel>

      <details className="group rounded-lg border bg-card" data-print="plain">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold">
          Funding into this account
          <span className="text-xs font-normal text-muted-foreground">
            {s.funding.length} {s.funding.length === 1 ? "transfer" : "transfers"} from the payer&apos;s treasury
            <span className="ml-2 group-open:hidden" data-print="hide">
              Show
            </span>
            <span className="ml-2 hidden group-open:inline" data-print="hide">
              Hide
            </span>
          </span>
        </summary>
        <div className="border-t">
          {s.funding.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted-foreground">No funding transfers in this period.</p>
          ) : (
            <FundingTable lines={s.funding} label="Funding transfers" />
          )}
        </div>
      </details>
      <ProveDialog ufvk={request.ufvk} line={proving} onOpenChange={(open) => !open && setProving(null)} />
    </article>
  );
}
