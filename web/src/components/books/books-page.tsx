"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CalendarDays, Check, ChevronDown, RefreshCw, TriangleAlert } from "lucide-react";
import { useHealth } from "@/components/app/health-provider";
import { PageTitle } from "@/components/ds/page";
import { useBooks } from "@/components/books/books-provider";
import {
  isValidPeriod,
  presetPeriods,
  shortRange,
  type BooksPeriod,
  type BooksResult,
} from "@/components/books/books-data";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatHeight, formatPeriodLabel, formatTime, networkLabel } from "@/lib/format";

/**
 * A Books page: title, the period and refresh controls, then the content once the scan is in.
 * Every page shares one scan held by the provider.
 */
export function BooksPage({
  title,
  children,
  header,
}: {
  title: ReactNode;
  children: (r: BooksResult) => ReactNode;
  /** Replace the standard title row (the Exports page centres its own). */
  header?: (controls: ReactNode, meta: ReactNode) => ReactNode;
}) {
  const { scan } = useBooks();
  const controls = (
    <div className="flex items-center gap-2" data-print="hide">
      <PeriodMenu />
      <RefreshButton />
    </div>
  );
  const meta = <ScanMeta />;
  return (
    <>
      {header ? (
        header(controls, meta)
      ) : (
        <PageTitle title={title} description={meta} actions={controls} className="sm:items-start" />
      )}
      {header ? null : <PrintPeriod />}
      {scan.status === "error" && scan.error ? (
        <ScanError />
      ) : scan.status === "ready" && scan.result ? (
        children(scan.result)
      ) : (
        <ScanProgress />
      )}
    </>
  );
}

/**
 * What was read and how: the number of viewing keys (and that the public sees none of it), then
 * the network and the blocks scanned. "From block N" is the service's own figure when it sends
 * one, else the birthday the request asked for.
 */
function ScanMeta() {
  const { scan, keys } = useBooks();
  const r = scan.result;
  const read = (
    <span className="block">
      Read with {keys.length} viewing {keys.length === 1 ? "key" : "keys"}. The public explorer shows none of this.
    </span>
  );
  if (!r || scan.status !== "ready") return read;
  const from = r.scanned_from_height ?? scan.birthday;
  const at = formatTime(r.generated_at).replace(/:\d\d UTC$/, " UTC");
  return (
    <>
      {read}
      <span className="num mt-0.5 block text-[0.8125rem]" data-testid="books-scan-meta">
        Zcash {networkLabel(r.network).toLowerCase()} ·{" "}
        {from
          ? `scanned from block ${formatHeight(from)} to ${formatHeight(r.scanned_to_height)} at ${at}`
          : `scanned to block ${formatHeight(r.scanned_to_height)} at ${at}`}
      </span>
    </>
  );
}

/** On paper the period pill is gone, so the period is printed under the title. */
function PrintPeriod() {
  const { period } = useBooks();
  if (!period) return null;
  return (
    <p data-print="text" className="mb-3 text-[10pt]">
      Payments mined {shortRange(period)} (UTC)
    </p>
  );
}

function RefreshButton() {
  const { refresh, scan } = useBooks();
  return (
    <Button
      type="button"
      variant="secondary"
      size="icon-sm"
      onClick={refresh}
      disabled={scan.status === "loading"}
      aria-label="Scan again"
      title="Scan again"
    >
      <RefreshCw aria-hidden="true" />
    </Button>
  );
}

/** Mercury's filter pill for the period, with presets, the latest run and a custom range. */
export function PeriodMenu() {
  const { period, setPeriod, latestRun } = useBooks();
  const [customOpen, setCustomOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const presets = presetPeriods();
  const same = (a: BooksPeriod | null, b: BooksPeriod) => !!a && a.from === b.from && a.to === b.to;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={trigger}
            type="button"
            variant="secondary"
            size="sm"
            aria-label={`Period: ${period ? shortRange(period) : "choosing"}`}
          >
            <CalendarDays aria-hidden="true" />
            <span className="num">{period ? shortRange(period) : "Finding the latest run"}</span>
            <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel>Payments mined in this period (UTC)</DropdownMenuLabel>
          {latestRun ? (
            <DropdownMenuItem onSelect={() => setPeriod(latestRun.period)}>
              <span className="grid flex-1">
                <span>Latest run, {formatPeriodLabel(latestRun.label)} payroll</span>
                <span className="num text-xs text-muted-foreground">{shortRange(latestRun.period)}</span>
              </span>
              {same(period, latestRun.period) ? <Check aria-hidden="true" /> : null}
            </DropdownMenuItem>
          ) : null}
          {presets.map((p) => (
            <DropdownMenuItem key={p.id} onSelect={() => setPeriod(p.period)}>
              <span className="grid flex-1">
                <span>{p.label}</span>
                <span className="num text-xs text-muted-foreground">{shortRange(p.period)}</span>
              </span>
              {same(period, p.period) ? <Check aria-hidden="true" /> : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCustomOpen(true)}>Custom range</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CustomRangeDialog open={customOpen} onOpenChange={setCustomOpen} returnFocus={trigger} />
    </>
  );
}

function CustomRangeDialog({
  open,
  onOpenChange,
  returnFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The period button: the menu item that opened the dialog is gone by the time it closes. */
  returnFocus: React.RefObject<HTMLButtonElement | null>;
}) {
  const { period, setPeriod } = useBooks();
  const [draft, setDraft] = useState<BooksPeriod>(period ?? presetPeriods()[0].period);
  useEffect(() => {
    if (open && period) setDraft(period);
  }, [open, period]);
  const valid = isValidPeriod(draft);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md"
        onCloseAutoFocus={(e) => {
          if (!returnFocus.current) return;
          e.preventDefault();
          returnFocus.current.focus();
        }}
      >
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            setPeriod(draft);
            onOpenChange(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>Custom period</DialogTitle>
            <DialogDescription>A payment counts on the day its block was mined, in UTC.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="books-from" className="font-normal">
                From
              </Label>
              <Input
                id="books-from"
                type="date"
                value={draft.from}
                onChange={(e) => setDraft({ ...draft, from: e.target.value })}
                aria-invalid={!valid}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="books-to" className="font-normal">
                To
              </Label>
              <Input
                id="books-to"
                type="date"
                value={draft.to}
                onChange={(e) => setDraft({ ...draft, to: e.target.value })}
                aria-invalid={!valid}
              />
            </div>
          </div>
          {!valid ? (
            <p role="alert" className="text-sm text-destructive">
              Start on or before the end, at most one year apart.
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid}>
              Use this period
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Real progress text while the chain is scanned: what is being read, with how many keys, for how long. */
export function ScanProgress() {
  const { scan, keys, period } = useBooks();
  const { health } = useHealth();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const seconds = scan.startedAt ? Math.max(0, Math.round((now - scan.startedAt) / 1000)) : 0;
  const net = health ? `Zcash ${networkLabel(health.network).toLowerCase()}` : "Zcash";
  const n = `${keys.length} viewing ${keys.length === 1 ? "key" : "keys"}`;
  const title =
    scan.phase === "finding-period"
      ? "Finding the latest payroll run"
      : scan.phase === "retrying"
        ? "The connection to the Zcash node dropped. Trying once more"
        : `Scanning ${net} with ${n}`;
  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-2 grid gap-4 rounded-xl border bg-card px-5 py-6 sm:px-6"
      data-testid="books-scanning"
    >
      <div className="flex items-start gap-3">
        <RefreshCw
          className="mt-1 size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none"
          aria-hidden="true"
        />
        <div className="grid gap-1">
          <p className="text-[1.0625rem] text-foreground">{title}</p>
          <p className="text-sm text-muted-foreground">
            The first scan of a key set takes longest while the service builds a view-only wallet for it; after that
            only new blocks are read.
          </p>
          <p className="num text-sm text-muted-foreground">
            {period ? `${shortRange(period)} · ` : ""}
            {health
              ? `reading ${scan.birthday ? `from block ${formatHeight(scan.birthday)} ` : ""}up to block ${formatHeight(health.chain_tip)} · `
              : ""}
            {seconds} s
          </p>
        </div>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-chip" aria-hidden="true">
        <div className="h-full w-1/3 animate-[books-sweep_1.6s_ease-in-out_infinite] rounded-full bg-muted-foreground/45 motion-reduce:animate-none" />
      </div>
      <style>{`@keyframes books-sweep{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}`}</style>
    </div>
  );
}

/** The API's message and hint in plain words, with Retry; the code sits behind a disclosure. */
const KEY_ERRORS = new Set(["invalid_viewing_key", "wrong_network", "spending_key_rejected", "too_many_keys"]);

export function ScanError() {
  const { scan, refresh, forget } = useBooks();
  const e = scan.error;
  if (!e) return null;
  const lwd = e.code === "lightwalletd_unreachable";
  const keyProblem = KEY_ERRORS.has(e.code);
  return (
    <div
      role="alert"
      className="mt-2 grid gap-3 rounded-xl border border-destructive/30 bg-danger-bg px-5 py-5 sm:px-6"
    >
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden="true" />
        <div className="grid gap-1">
          <p className="text-[1.0625rem] text-foreground">
            {lwd ? "The Zcash node did not answer, twice" : "The books could not be loaded"}
          </p>
          <p className="text-sm text-strong">
            {lwd ? "Payslip retried once on its own. " : ""}
            {e.message}
          </p>
          {e.hint ? <p className="text-sm text-muted-foreground">{e.hint}</p> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 pl-8">
        {keyProblem ? (
          <Button type="button" variant="secondary" size="sm" onClick={forget}>
            Start again with other keys
          </Button>
        ) : (
          <Button type="button" variant="secondary" size="sm" onClick={refresh}>
            <RefreshCw aria-hidden="true" />
            Retry
          </Button>
        )}
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Details</summary>
          <p className="mt-1 font-mono">
            {e.code}
            {e.status ? `, HTTP ${e.status}` : ""}
          </p>
        </details>
      </div>
    </div>
  );
}
