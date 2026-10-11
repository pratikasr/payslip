"use client";

import Link from "next/link";
import { useHealth } from "@/components/app/health-provider";
import { StatusStamp } from "@/components/portal/paper-parts";
import { cn } from "cn";
import { TREASURY_KEY_HREF } from "./unlock";

/**
 * The typed "TREASURY LOCKED" stamp beside the network badge in the console's top bar, while
 * the treasury key is locked. The stamp is the word itself (no icon), red because a person is
 * needed; it opens the key page, where an admin unlocks it.
 */
export function TreasuryLockedStamp({ className }: { className?: string }) {
  const { treasury } = useHealth();
  if (treasury !== "locked") return null;
  return (
    <Link
      href={TREASURY_KEY_HREF}
      className={cn("inline-flex shrink-0 items-center", className)}
      title="Nobody can spend the treasury until an admin unlocks it. Open the treasury key page."
      data-testid="treasury-locked-stamp"
      data-print="hide"
    >
      <StatusStamp tone="red" tilt="right" className="text-[0.75rem]">
        Treasury locked
      </StatusStamp>
    </Link>
  );
}
