"use client";

import { useState } from "react";
import { KeyRound, ScanLine, TriangleAlert } from "lucide-react";
import { useHealth } from "@/components/app/health-provider";
import { LogoMark } from "@/components/app/logo";
import { KeyStatus } from "@/components/keys/key-status";
import { ScanDialog } from "@/components/keys/scan-dialog";
import { usePortal } from "@/components/portal/portal-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { classifyKey } from "@/lib/keys";

/** Accepts the key itself or a whole invite link (…/portal#key=…), pasted or scanned. */
function keyFromText(text: string): string {
  const m = /#key=([^\s&]+)/.exec(text);
  if (!m) return text;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/**
 * The locked portal: one calm card. The key is checked in the browser first (a spending key or
 * seed never leaves the page), then kept for this tab only.
 */
export function UnlockScreen() {
  const { unlock, lockReason } = usePortal();
  const { health } = useHealth();
  const [raw, setRaw] = useState("");
  const [touched, setTouched] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);

  const result = classifyKey(keyFromText(raw));
  const mismatch = result.kind === "ufvk" && !!health && result.network !== health.network;
  const showStatus = touched && raw.trim() !== "";

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (result.kind === "ufvk" && !mismatch) unlock(result.value);
  };

  return (
    <main id="main" className="grid min-h-[calc(100dvh-3rem)] place-items-center bg-sidebar px-4 py-10 sm:py-16">
      <div className="w-full max-w-[460px]">
        <section
          aria-labelledby="unlock-title"
          className="rounded-xl border bg-card px-6 py-8 text-card-foreground sm:px-9 sm:py-10"
        >
          <LogoMark className="size-8" />
          <h1 id="unlock-title" className="mt-5 text-[1.75rem] leading-tight font-[380] tracking-[-0.015em]">
            Open your payslips
          </h1>
          <p className="mt-1.5 text-[0.9375rem] text-muted-foreground">
            Paste the viewing key your payer sent you, or scan its QR code.
          </p>

          {lockReason ? (
            <div
              role="alert"
              className="mt-5 flex items-start gap-2.5 rounded-[10px] bg-danger-bg px-3.5 py-3 text-sm text-foreground"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
              <span>{lockReason}</span>
            </div>
          ) : null}

          <form onSubmit={submit} noValidate className="mt-6 space-y-3">
            <div className="flex items-end justify-between gap-2">
              <Label htmlFor="portal-key" className="text-[0.9375rem] font-normal">
                Viewing key
              </Label>
              <Button type="button" variant="secondary" size="sm" onClick={() => setScanOpen(true)}>
                <ScanLine aria-hidden="true" />
                Scan QR
              </Button>
            </div>
            <Textarea
              id="portal-key"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              onBlur={() => setTouched(true)}
              rows={4}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              placeholder="uviewtest1… or uview1…"
              className="min-h-24 font-mono text-xs break-all md:text-xs"
              aria-invalid={showStatus && (result.kind !== "ufvk" || mismatch)}
              aria-describedby="portal-key-status"
            />
            {showStatus ? (
              <KeyStatus result={result} serviceNetwork={health?.network} id="portal-key-status" />
            ) : (
              <p id="portal-key-status" className="sr-only">
                A unified full viewing key starts with uview or uvf on mainnet, uviewtest or uvftest on testnet.
              </p>
            )}
            <Button type="submit" size="lg" className="mt-2 w-full" disabled={raw.trim() === ""}>
              Open payslips
            </Button>
          </form>

          <p className="mt-6 flex items-start gap-2.5 border-t border-hairline pt-5 text-sm text-muted-foreground">
            <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Your viewing key reads payments to you. It cannot move money.
          </p>
        </section>
        <p className="mt-4 px-2 text-center text-xs text-muted-foreground">
          The key stays in this browser tab and is sent only to the Payslip service.
        </p>
      </div>

      <ScanDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        onResult={(v) => {
          // Scanning is the action: a valid key or invite link opens the payslips at once; anything
          // else lands in the field with the reason shown.
          const scanned = classifyKey(keyFromText(v.trim()));
          if (scanned.kind === "ufvk" && !(health && scanned.network !== health.network)) {
            unlock(scanned.value);
            return;
          }
          setRaw(v.trim());
          setTouched(true);
        }}
      />
    </main>
  );
}
