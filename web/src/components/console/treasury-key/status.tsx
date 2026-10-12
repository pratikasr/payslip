"use client";

import Link from "next/link";
import { KeyRound } from "lucide-react";
import { useHealth } from "@/components/app/health-provider";
import { Card, CardHeader } from "@/components/ds/card";
import { StatusStamp, type StampTone } from "@/components/portal/paper-parts";
import { Button } from "@/components/ui/button";
import type { TreasuryKey, TreasuryKeyState } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { cn } from "cn";
import { IconChip } from "@/components/console/ui";
import { TREASURY_KEY_HREF } from "./unlock";

/*
  The key's state, said one way everywhere: the stamp on the key page, the line on the Treasury
  page, the card under Settings.
*/

/** The stamp's word, its ink and one sentence, per state. */
export function keyStateInfo(state: TreasuryKeyState | undefined, until?: string | null) {
  switch (state) {
    case "locked":
      return {
        label: "Locked",
        tone: "red" as StampTone,
        sentence: "Nobody can spend the treasury, including this server, until an admin unlocks it.",
      };
    case "unlocked":
      return {
        label: "Unlocked",
        tone: "ink" as StampTone,
        sentence: until
          ? `This server can sign payments until ${formatDateTime(until)}, then the key locks itself.`
          : "This server can sign payments until the key locks itself.",
      };
    case "unlocked_by_env":
      return {
        label: "Unlocked by server configuration",
        tone: "ink" as StampTone,
        sentence:
          "PAYSLIP_SEED_PASSPHRASE is set on the service, so the key is decrypted whenever the service runs. Remove that setting and restart to lock it.",
      };
    case "no_key":
      return { label: "No key", tone: "soft" as StampTone, sentence: "No treasury key has been created yet." };
    default:
      return {
        label: "Not reported",
        tone: "soft" as StampTone,
        sentence:
          "This service does not report its treasury key; it was started with a seed file and PAYSLIP_SEED_PASSPHRASE.",
      };
  }
}

/** The state as a stamp with its sentence, for the key page. */
export function KeyStateStamp({
  state,
  until,
  className,
}: {
  state: TreasuryKeyState | undefined;
  until?: string | null;
  className?: string;
}) {
  const info = keyStateInfo(state, until);
  return (
    <StatusStamp tone={info.tone} tilt="none" className={cn("text-[0.8125rem]", className)} title={info.sentence}>
      {info.label}
    </StatusStamp>
  );
}

/** One typed line for the Treasury page: the key's state and the way to the key page. */
export function TreasuryKeyLine({ className }: { className?: string }) {
  const { treasury } = useHealth();
  const info = keyStateInfo(treasury);
  return (
    <p className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5 font-type text-[0.8125rem]", className)}>
      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
        <KeyRound className="size-3.5" aria-hidden="true" />
        Treasury key
      </span>
      <StatusStamp tone={info.tone} tilt="none" className="text-[0.6875rem]" title={info.sentence}>
        {info.label}
      </StatusStamp>
      <Link
        href={TREASURY_KEY_HREF}
        className="font-bold text-link underline decoration-1 underline-offset-[3px] hover:decoration-2"
      >
        {treasury === "locked" ? "Unlock" : "How it is protected"}
      </Link>
    </p>
  );
}

/** The card under Settings: the state in a sentence, and the way to the key page. */
export function TreasuryKeyCard({ initial, className }: { initial?: TreasuryKey; className?: string }) {
  const { treasury } = useHealth();
  const state = treasury ?? initial?.state;
  const info = keyStateInfo(state, initial?.unlocked_until);
  return (
    <Card aria-labelledby="treasury-key-title" className={cn("flex flex-col", className)}>
      <CardHeader id="treasury-key-title" title="Treasury key" actions={<IconChip icon={KeyRound} />} />
      <p className="mt-2 flex flex-wrap items-center gap-2">
        <StatusStamp tone={info.tone} tilt="none" className="text-[0.75rem]" title={info.sentence}>
          {info.label}
        </StatusStamp>
      </p>
      <p className="mt-2 text-[0.8125rem] text-muted-foreground">{info.sentence}</p>
      <p className="mt-1.5 text-[0.8125rem] text-muted-foreground">
        Your spending key, made in your browser and sealed with your passphrase. The key page says how it is protected
        and, in plain words, who can spend it.
      </p>
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-ink pt-4">
        <Button asChild variant="secondary" size="sm">
          <Link href={TREASURY_KEY_HREF}>Treasury key</Link>
        </Button>
      </div>
    </Card>
  );
}
