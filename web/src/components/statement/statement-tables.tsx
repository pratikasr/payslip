import { Rate, Usd, Zec } from "@/components/app/amount";
import { Hash } from "@/components/app/hash";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { FundingLine, StatementLine, UnlabelledLine } from "@/lib/api";
import { formatDate, formatHeight, formatPeriodLabel } from "@/lib/format";

type Line = StatementLine & { label?: string | null; account_index?: number | null };

export function StatementLinesTable({
  lines,
  label,
  showContractor,
  showRunning = true,
  showRate = true,
  testnet = false,
}: {
  lines: Line[];
  label: string;
  showContractor?: boolean;
  showRunning?: boolean;
  showRate?: boolean;
  /** Label the rate column as the testnet fixed rate. */
  testnet?: boolean;
}) {
  const minWidth = 720 + (showContractor ? 160 : 0) + (showRunning ? 240 : 0) + (showRate ? 120 : 0);
  return (
    <>
      <ul className="divide-y md:hidden print:hidden" aria-label={label}>
        {lines.map((l, i) => (
          <li key={`${l.txid}-${i}`} className="space-y-1.5 px-4 py-3 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">
                {showContractor ? `${l.label ?? "Unknown account"}, ` : ""}
                {formatDate(l.block_time ?? l.date)}
              </span>
              <Usd cents={l.usd_basis_cents} className="font-medium" />
            </div>
            <div className="flex items-baseline justify-between gap-3 text-muted-foreground">
              <span>
                {formatPeriodLabel(l.period)}
                {l.invoice_ref ? `, ${l.invoice_ref}` : ""}
              </span>
              <Zec zat={l.amount_zat} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <Hash value={l.txid} label="transaction id" explorerUrl={l.explorer_url} />
              <span className="num">{l.height ? `Height ${formatHeight(l.height)}` : "Not mined"}</span>
            </div>
            {showRunning ? (
              <p className="num text-xs text-muted-foreground">
                Running total <Usd cents={l.running_usd_cents} />, <Zec zat={l.running_zat} />
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="hidden md:block print:block">
        <Table label={label} minWidth={minWidth}>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              {showContractor ? <TableHead>Contractor</TableHead> : null}
              <TableHead numeric>ZEC</TableHead>
              <TableHead numeric>USD basis</TableHead>
              {showRate ? <TableHead numeric>{testnet ? "Testnet fixed rate" : "Rate"}</TableHead> : null}
              <TableHead>Invoice</TableHead>
              <TableHead>Run period</TableHead>
              <TableHead>Transaction</TableHead>
              <TableHead numeric>Height</TableHead>
              {showRunning ? <TableHead numeric>Running ZEC</TableHead> : null}
              {showRunning ? <TableHead numeric>Running USD</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l, i) => (
              <TableRow key={`${l.txid}-${i}`}>
                <TableCell>{formatDate(l.block_time ?? l.date)}</TableCell>
                {showContractor ? (
                  <TableCell>
                    <div className="font-medium">{l.label ?? "Unknown account"}</div>
                    {l.account_index !== null && l.account_index !== undefined ? (
                      <div className="text-xs text-muted-foreground">Account {l.account_index}</div>
                    ) : null}
                  </TableCell>
                ) : null}
                <TableCell numeric>
                  <Zec zat={l.amount_zat} unit={false} />
                </TableCell>
                <TableCell numeric>
                  <Usd cents={l.usd_basis_cents} />
                </TableCell>
                {showRate ? (
                  <TableCell numeric>
                    <Rate e6={l.rate_usd_per_zec_e6} unit={false} />
                  </TableCell>
                ) : null}
                <TableCell>{l.invoice_ref || <span className="text-muted-foreground">None</span>}</TableCell>
                <TableCell>{formatPeriodLabel(l.period)}</TableCell>
                <TableCell>
                  <Hash value={l.txid} label="transaction id" explorerUrl={l.explorer_url} />
                </TableCell>
                <TableCell numeric>
                  {l.height ? formatHeight(l.height) : <span className="text-muted-foreground">Not mined</span>}
                </TableCell>
                {showRunning ? (
                  <TableCell numeric className="text-muted-foreground">
                    <Zec zat={l.running_zat} unit={false} />
                  </TableCell>
                ) : null}
                {showRunning ? (
                  <TableCell numeric className="text-muted-foreground">
                    <Usd cents={l.running_usd_cents} />
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

const REASONS: Record<UnlabelledLine["reason"], string> = {
  no_memo: "No memo",
  unknown_prefix: "Not a Payslip memo",
  malformed: "Payslip memo that could not be read",
};

export function UnlabelledTable({ lines, label }: { lines: UnlabelledLine[]; label: string }) {
  return (
    <Table label={label} minWidth={860}>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Direction</TableHead>
          <TableHead numeric>ZEC</TableHead>
          <TableHead>Why unlabelled</TableHead>
          <TableHead>Memo text</TableHead>
          <TableHead>Transaction</TableHead>
          <TableHead numeric>Height</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((l, i) => (
          <TableRow key={`${l.txid}-${i}`}>
            <TableCell>{formatDate(l.date)}</TableCell>
            <TableCell>{l.direction === "in" ? "Received" : "Sent"}</TableCell>
            <TableCell numeric>
              <Zec zat={l.amount_zat} unit={false} />
            </TableCell>
            <TableCell>{REASONS[l.reason] ?? l.reason}</TableCell>
            <TableCell className="max-w-64 truncate" title={l.memo_text ?? undefined}>
              {l.memo_text ? (
                <span className="font-mono text-xs">{l.memo_text}</span>
              ) : (
                <span className="text-muted-foreground">None</span>
              )}
            </TableCell>
            <TableCell>
              <Hash value={l.txid} label="transaction id" />
            </TableCell>
            <TableCell numeric>{formatHeight(l.height)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function FundingTable({ lines, label }: { lines: FundingLine[]; label: string }) {
  return (
    <Table label={label} minWidth={640}>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead numeric>ZEC</TableHead>
          <TableHead>Run</TableHead>
          <TableHead>Transaction</TableHead>
          <TableHead numeric>Height</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((l, i) => (
          <TableRow key={`${l.txid}-${i}`}>
            <TableCell>{formatDate(l.date)}</TableCell>
            <TableCell numeric>
              <Zec zat={l.amount_zat} unit={false} />
            </TableCell>
            <TableCell>
              {l.run_id ? (
                <Hash value={l.run_id} label="run id" head={8} tail={4} />
              ) : (
                <span className="text-muted-foreground">None</span>
              )}
            </TableCell>
            <TableCell>
              <Hash value={l.txid} label="transaction id" />
            </TableCell>
            <TableCell numeric>{formatHeight(l.height)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
