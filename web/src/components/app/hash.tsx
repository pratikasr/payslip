import { ExternalLink } from "lucide-react";
import { CopyButton } from "@/components/app/copy-button";
import { truncateMiddle } from "@/lib/format";
import { cn } from "cn";

interface HashProps {
  value: string | null | undefined;
  /** "transaction id", "address", "viewing key" */
  label: string;
  explorerUrl?: string | null;
  head?: number;
  tail?: number;
  empty?: string;
  className?: string;
}

/** A long identifier truncated in the middle, with copy and an optional explorer link. */
export function Hash({ value, label, explorerUrl, head = 8, tail = 6, empty = "Not yet", className }: HashProps) {
  if (!value) return <span className="text-muted-foreground">{empty}</span>;
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      <code className="font-mono text-[0.8125rem]" title={value}>
        <span data-print="hide">{truncateMiddle(value, head, tail)}</span>
        <span data-print="only" className="break-all">
          {value}
        </span>
      </code>
      <CopyButton value={value} label={label} />
      {explorerUrl ? (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex size-6 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={`Open ${label} in block explorer (opens in a new tab)`}
          title="Open in block explorer"
          data-print="hide"
        >
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      ) : null}
    </span>
  );
}
