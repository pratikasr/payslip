"use client";

import { useEffect, useRef, useState } from "react";
import { KeyRound, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

/*
  The landing page's one orchestrated moment. The same pay line is shown
  twice: the block explorer's copy stays sealed; on the accountant's copy a
  viewing key lifts each redaction bar in turn. It plays once when it comes
  into view (under two seconds, so no pause control is needed) and Replay
  runs it again. With reduced motion the opened state shows at once.

  Values are an illustration, labelled as such in the caption.
*/

const ROWS: { label: string; value: React.ReactNode; bar: string }[] = [
  { label: "From", value: "Payroll account 1", bar: "w-[72%]" },
  { label: "To", value: "Amara Okafor", bar: "w-[66%]" },
  { label: "Amount", value: <span className="num">3.54262000 ZEC</span>, bar: "w-[78%]" },
  { label: "USD basis", value: <span className="num">$4,800.00</span>, bar: "w-[48%]" },
  { label: "Period", value: "Sep 2026", bar: "w-[52%]" },
  { label: "Invoice", value: <span className="whitespace-nowrap">INV-2026-014</span>, bar: "w-[84%]" },
];

const KEY_AT = 550; // ms: the key is applied
const STEP = 170; // ms between rows

export function UnsealDemo() {
  const ref = useRef<HTMLElement>(null);
  const [playing, setPlaying] = useState(false);
  const [round, setRound] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setPlaying(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setPlaying(true);
          io.disconnect();
        }
      },
      { threshold: 0.45 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <figure ref={ref} className="unseal min-w-0" data-play={playing ? "" : undefined}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Pane title="Block explorer" note="What anyone sees">
          {ROWS.map((r) => (
            <Row key={r.label} label={r.label}>
              <span className="block">
                <span aria-hidden="true" className={cn("block h-3.5 rounded-[3px] bg-redact", r.bar)} />
                <span className="sr-only">Hidden</span>
              </span>
            </Row>
          ))}
        </Pane>

        <Pane
          key={round}
          title="Accountant"
          open
          note={
            <span className="relative inline-grid text-xs">
              <span className="sr-only">Opened with a viewing key</span>
              <span aria-hidden="true" className="ps-swap-out col-start-1 row-start-1 text-muted-foreground">
                Sealed
              </span>
              <span
                aria-hidden="true"
                className="ps-swap-in col-start-1 row-start-1 inline-flex items-center gap-1 font-medium whitespace-nowrap"
              >
                <KeyRound className="size-3.5 text-primary-edge" />
                Viewing key applied
              </span>
            </span>
          }
        >
          {ROWS.map((r, i) => (
            <Row key={r.label} label={r.label}>
              <span className="relative block">
                <span className="ps-reveal block" style={{ animationDelay: `${KEY_AT + 150 + i * STEP + 160}ms` }}>
                  {r.value}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "ps-unseal-bar pointer-events-none absolute top-1/2 left-0 block h-3.5 -translate-y-1/2 rounded-[3px] bg-redact",
                    r.bar,
                  )}
                  style={{ animationDelay: `${KEY_AT + 150 + i * STEP}ms` }}
                />
              </span>
            </Row>
          ))}
        </Pane>
      </div>
      <figcaption className="mt-3 flex items-start justify-between gap-3 text-xs text-muted-foreground">
        <span>
          One pay line, two views; the period and invoice travel in the encrypted memo. An illustration with example
          values: in the app every figure comes from your own runs on chain.
        </span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="shrink-0 text-muted-foreground"
          onClick={() => {
            setPlaying(true);
            setRound((n) => n + 1);
          }}
        >
          <RotateCcw aria-hidden="true" />
          Replay
        </Button>
      </figcaption>
      <noscript>
        <style>{`.unseal *{animation-play-state:running!important}`}</style>
      </noscript>
    </figure>
  );
}

function Pane({
  title,
  note,
  open,
  children,
}: {
  title: string;
  note: React.ReactNode;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-lg border bg-card p-4", open && "ps-edge")}>
      <div className="mb-4 flex items-center justify-between gap-2 border-b pb-3">
        <p className="text-sm font-semibold">{title}</p>
        <div className="text-xs text-muted-foreground">{note}</div>
      </div>
      <dl className="space-y-3">
        <Row label="Transaction">Shielded</Row>
        {children}
      </dl>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-6 grid-cols-[4.75rem_minmax(0,1fr)] items-center gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
