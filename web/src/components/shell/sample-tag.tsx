"use client";

import { useHealth } from "@/components/app/health-provider";
import { Tag } from "@/components/ds/tag";
import { SAMPLE_COMPANY_LINE, isSampleCompany } from "@/lib/company";
import { cn } from "cn";

/** Whether the service is on testnet, where everything on screen is the sample company's. */
export function useSampleCompany(): boolean {
  const { network } = useHealth();
  return isSampleCompany(network);
}

/**
 * The quiet "Sample data" tag beside the company name on testnet. Its tooltip gives the full
 * line; the tag renders nothing on mainnet or while the network is still unknown.
 */
export function SampleTag({ className }: { className?: string }) {
  const sample = useSampleCompany();
  if (!sample) return null;
  return (
    <Tag className={cn("h-5 shrink-0 px-1.5 text-xs text-muted-foreground", className)} title={SAMPLE_COMPANY_LINE}>
      Sample data
    </Tag>
  );
}
