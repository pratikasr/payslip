import type { ReactNode } from "react";
import { cn } from "cn";
import { TearLine } from "@/components/ds/paper";
import { formatHeight, truncateMiddle } from "@/lib/format";
import { explorerTx } from "@/components/marketing/data";
import { t } from "@/components/marketing/classes";

/** The sheet's column: the width between the feed edges, with a printed form's margins. */
export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("w-full px-3 sm:px-6 lg:px-11", className)}>{children}</div>;
}

/**
 * A section of the sheet: torn off the part above it, a display heading and, when given, one
 * short lead under it.
 */
export function Section({
  id,
  title,
  lead,
  children,
  className,
}: {
  id: string;
  title: ReactNode;
  lead?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn("scroll-mt-20", className)}>
      <Container>
        <TearLine />
        <div className="pt-12 pb-14 md:pt-16 md:pb-20">
          <h2 id={`${id}-title`} className={cn(t.h2, "max-w-[22ch]")}>
            {title}
          </h2>
          {lead ? <div className={cn(t.lead, "mt-4 max-w-[38rem] md:mt-5")}>{lead}</div> : null}
          {children}
        </div>
      </Container>
    </section>
  );
}

/** A txid, middle-truncated unless `full`, linked to the testnet explorer in a new tab. */
export function TxLink({
  txid,
  className,
  head = 6,
  tail = 4,
  children,
}: {
  txid: string;
  className?: string;
  head?: number;
  tail?: number;
  children?: ReactNode;
}) {
  return (
    <a
      href={explorerTx(txid)}
      target="_blank"
      rel="noreferrer"
      title={txid}
      data-txid={txid}
      className={cn(
        t.data,
        "whitespace-nowrap text-ink underline decoration-ink/35 decoration-1 underline-offset-[3px] transition-colors hover:decoration-ink",
        className,
      )}
    >
      {children ?? truncateMiddle(txid, head, tail)}
      <span className="sr-only"> (transaction on the Zcash testnet explorer, opens in a new tab)</span>
    </a>
  );
}

/** A block height, set as chain data. */
export function Height({ height, className }: { height: number; className?: string }) {
  return <span className={cn(t.data, "tabular-nums", className)}>{formatHeight(height)}</span>;
}

/** A link that leaves the site, announced to screen readers as opening a new tab. */
export function OutLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
