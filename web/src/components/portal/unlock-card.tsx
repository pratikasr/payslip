"use client";

import { useEffect, useRef, useState } from "react";
import { FileJson, FlaskConical, KeyRound, ScanLine, TriangleAlert } from "lucide-react";
import { useHealth } from "@/components/app/health-provider";
import { LogoMark } from "@/components/app/logo";
import { KeyStatus } from "@/components/keys/key-status";
import { ScanDialog } from "@/components/keys/scan-dialog";
import { parseKeyFile, usableKeys, type BookKey } from "@/components/books/books-data";
import { JUDGE_KIT_URL } from "@/components/books/key-import";
import { useDocumentTitle } from "@/components/portal/document-title";
import { NO_META, parseInvite, type KeyMeta } from "@/components/portal/portal-data";
import { usePortal } from "@/components/portal/portal-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { classifyKey } from "@/lib/keys";

/** The judge kit contractor the demo key opens. */
const DEMO_PERSON = "Amara Okafor";

/** How long typing must pause before the key is checked aloud (a paste is checked at once). */
const SETTLE_MS = 600;

/**
 * The locked portal: one calm card. The key is checked in the browser first (a spending key or
 * seed never leaves the page), then kept for this tab only.
 *
 * The status line under the field always takes the same room (a hint until there is something to
 * say), and it never appears on blur: a status that pushed the button down between mousedown and
 * mouseup used to swallow the first click on Open payslips.
 */
export function UnlockScreen() {
  const { unlock, lockReason } = usePortal();
  const { health } = useHealth();
  const [raw, setRaw] = useState("");
  const [touched, setTouched] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [choices, setChoices] = useState<BookKey[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const invite = parseInvite(raw);
  const result = classifyKey(invite.key);
  const mismatch = result.kind === "ufvk" && !!health && result.network !== health.network;
  const showStatus = touched && raw.trim() !== "";

  useDocumentTitle("Open your payslips | Payslip");

  // Typing: say whether the key is usable once the person pauses, not on every character.
  useEffect(() => {
    if (touched || raw.trim() === "") return;
    const t = setTimeout(() => setTouched(true), SETTLE_MS);
    return () => clearTimeout(t);
  }, [raw, touched]);

  const open = (key: string, meta: KeyMeta) => {
    setChoices(null);
    unlock(key, meta);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (result.kind === "ufvk" && !mismatch) open(result.value, invite.meta);
  };

  /**
   * A key file (the company's export or the judge kit): one contractor key opens at once, several
   * ask whose. `only` picks one by name, for the demo key.
   */
  const openFile = (text: string, only?: string) => {
    setFileError(null);
    setChoices(null);
    try {
      const parsed = parseKeyFile(text);
      const usable = usableKeys(parsed.keys, health?.network).filter(
        (k) => k.role !== "treasury" && (!only || k.label === only),
      );
      if (usable.length === 0) {
        setFileError(
          health && parsed.network && parsed.network !== health.network
            ? `This key file is for ${parsed.network}, but this service runs on ${health.network}.`
            : "This file has no contractor viewing key Payslip can use.",
        );
      } else if (usable.length === 1) {
        const k = usable[0];
        open(k.ufvk, { label: k.label, birthday: k.birthday ?? null });
      } else {
        setChoices(usable);
      }
    } catch (err) {
      setFileError((err as Error).message);
    }
  };

  const onFile = async (file: File) => openFile(await file.text());

  const [demoBusy, setDemoBusy] = useState(false);
  const openDemo = async () => {
    setDemoBusy(true);
    try {
      const res = await fetch(JUDGE_KIT_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("The demo key is not published on this deployment.");
      openFile(await res.text(), DEMO_PERSON);
    } catch (err) {
      setFileError((err as Error).message);
    } finally {
      setDemoBusy(false);
    }
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
              <Label htmlFor="portal-key" className="text-[0.9375rem] font-normal whitespace-nowrap">
                Viewing key
              </Label>
              <span className="flex gap-1.5">
                <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                  <FileJson aria-hidden="true" />
                  Key file
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setScanOpen(true)}>
                  <ScanLine aria-hidden="true" />
                  Scan QR
                </Button>
              </span>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="sr-only"
                tabIndex={-1}
                aria-label="Key file"
                data-testid="portal-key-file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onFile(f);
                  e.target.value = "";
                }}
              />
            </div>
            <Textarea
              id="portal-key"
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value);
                setTouched(false);
              }}
              onPaste={() => setTimeout(() => setTouched(true), 0)}
              rows={4}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              placeholder="uviewtest1… or uview1…"
              className="min-h-24 font-mono text-xs break-all md:text-xs"
              aria-invalid={showStatus && (result.kind !== "ufvk" || mismatch)}
              aria-describedby="portal-key-status"
            />
            {/* Always the same room, so the button below never moves while it is being clicked. */}
            <div className="min-h-11" aria-live="polite">
              {showStatus ? (
                <KeyStatus result={result} serviceNetwork={health?.network} id="portal-key-status" />
              ) : (
                <p id="portal-key-status" className="text-sm text-muted-foreground">
                  A full viewing key starts with uviewtest or uvftest on testnet, uview or uvf on mainnet.
                </p>
              )}
            </div>
            {fileError ? (
              <p role="alert" className="flex items-start gap-2 text-sm text-danger">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>{fileError}</span>
              </p>
            ) : null}
            {choices ? (
              <fieldset className="rounded-[10px] border px-3.5 pt-2.5 pb-3">
                <legend className="px-1 text-sm text-strong">Whose payslips?</legend>
                <p className="mb-2 text-xs text-muted-foreground">
                  This file holds {choices.length} contractor keys. Open one at a time.
                </p>
                <div className="flex flex-wrap gap-2">
                  {choices.map((k, i) => (
                    <Button
                      key={k.ufvk}
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => open(k.ufvk, { label: k.label, birthday: k.birthday ?? null })}
                    >
                      {k.label ?? `Key ${i + 1}`}
                    </Button>
                  ))}
                </div>
              </fieldset>
            ) : null}
            <Button type="submit" size="lg" className="w-full" disabled={raw.trim() === ""}>
              Open payslips
            </Button>
          </form>
          {health?.network === "testnet" ? (
            <Button
              type="button"
              variant="ghost"
              className="mt-2 h-auto w-full py-2 whitespace-normal"
              onClick={() => void openDemo()}
              disabled={demoBusy}
              data-testid="portal-demo-key"
            >
              <FlaskConical aria-hidden="true" />
              {demoBusy ? "Opening the demo key" : `Try it with a demo key (${DEMO_PERSON}, from the judge kit)`}
            </Button>
          ) : null}

          <p className="mt-6 flex items-start gap-2.5 border-t border-hairline pt-5 text-sm text-muted-foreground">
            <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Your viewing key reads payments to you. It cannot move money.
          </p>
        </section>
        <p className="mt-4 px-2 text-center text-xs text-muted-foreground">
          The key stays in this browser tab and is sent only to the Payslip service, which keeps a read-only scan of
          your payments so the next visit is quick. Lock forgets it here; you can also ask the service to forget it.
        </p>
      </div>

      <ScanDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        onResult={(v) => {
          // Scanning is the action: a valid key or invite link opens the payslips at once; anything
          // else lands in the field with the reason shown.
          const scanned = parseInvite(v);
          const key = classifyKey(scanned.key);
          if (key.kind === "ufvk" && !(health && key.network !== health.network)) {
            open(key.value, scanned.meta ?? NO_META);
            return;
          }
          setRaw(v.trim());
          setTouched(true);
        }}
      />
    </main>
  );
}
