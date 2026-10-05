import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { cn } from "cn";
import { truncateMiddle } from "@/lib/format";
import { explorerTx } from "@/components/marketing/data";

/** The landing page's content column: Mercury's ~1024px measure with a 16px phone gutter. */
export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[66rem] px-4 sm:px-6", className)}>{children}</div>;
}

/**
 * Mercury's section opener: a hairline across the column, then a light 28 to 32px title.
 * `lead` is one short sentence under it.
 */
export function SectionHeading({
  id,
  title,
  lead,
  className,
  rule = true,
}: {
  id: string;
  title: ReactNode;
  lead?: ReactNode;
  className?: string;
  rule?: boolean;
}) {
  return (
    <div className={cn(rule && "border-t pt-10 sm:pt-12", className)}>
      <h2
        id={id}
        className="max-w-[34rem] text-[1.75rem] leading-[1.15] font-[450] tracking-[-0.015em] text-balance sm:text-[2rem]"
      >
        {title}
      </h2>
      {lead ? (
        <p className="mt-3 max-w-[40rem] text-[0.9375rem] leading-relaxed text-muted-foreground sm:text-base">{lead}</p>
      ) : null}
    </div>
  );
}

/** A txid, middle-truncated, linked to the testnet explorer in a new tab. */
export function TxLink({
  txid,
  className,
  head = 6,
  tail = 4,
}: {
  txid: string;
  className?: string;
  head?: number;
  tail?: number;
}) {
  return (
    <a
      href={explorerTx(txid)}
      target="_blank"
      rel="noreferrer"
      title={txid}
      data-txid={txid}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-sm font-mono text-[0.8125rem] whitespace-nowrap text-link underline-offset-4 hover:underline",
        className,
      )}
    >
      {truncateMiddle(txid, head, tail)}
      <ArrowUpRight className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="sr-only"> (transaction on the Zcash testnet explorer, opens in a new tab)</span>
    </a>
  );
}

/** A link that leaves the site: a small arrow, and a new tab announced to screen readers. */
export function OutLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn("inline-flex items-center gap-1 rounded-sm underline-offset-4 hover:underline", className)}
    >
      {children}
      <ArrowUpRight className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/** The gold dot that marks something shielded. */
export function GoldDot({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("inline-block size-2 shrink-0 rounded-full bg-primary", className)} />;
}
