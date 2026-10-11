"use client";

import { useEffect, useRef, useState } from "react";
import { FileJson, KeyRound, ScanLine, TriangleAlert } from "lucide-react";
import { useHealth } from "@/components/app/health-provider";
import { LogoMark } from "@/components/app/logo";
import { Sheet } from "@/components/ds/paper";
import { KeyStatus } from "@/components/keys/key-status";
import { ScanDialog } from "@/components/keys/scan-dialog";
import { parseKeyFile, usableKeys, type BookKey } from "@/components/books/books-data";
import { JUDGE_KIT_URL } from "@/components/books/key-import";
import { useDocumentTitle } from "@/components/portal/document-title";
import { NO_META, parseInvite, type KeyMeta } from "@/components/portal/portal-data";
import { TypedBox } from "@/components/portal/paper-parts";
import { usePortal } from "@/components/portal/portal-provider";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { classifyKey } from "@/lib/keys";
import { TYPE } from "@/components/ds/type";
import { cn } from "cn";

/** The judge kit contractor the demo key opens. */
const DEMO_PERSON = "Amara Okafor";

/** How long typing must pause before the key is checked aloud (a paste is checked at once). */
const SETTLE_MS = 600;

/**
 * The locked portal: one form on a sheet of continuous paper. The key is checked in the browser first (a spending key or
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
    <main id="main" className="min-h-[calc(100dvh-3rem)] bg-desk px-2 py-6 sm:px-4 sm:py-12">
      <Sheet as="section" aria-labelledby="unlock-title" className="mx-auto w-full max-w-[620px]">
        <div className="px-2 pt-6 pb-8 sm:px-8 sm:pt-8 sm:pb-10">
          {/* The form's head: whose form it is, and the copy's label line. */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b-2 border-foreground pb-3">
            <span className="inline-flex items-center gap-2 font-type text-[1rem] font-bold">
              <LogoMark className="size-[22px]" />
              Payslip
            </span>
            <span className="form-label text-[0.75rem] text-muted-foreground">Read-only access</span>
          </div>
          <h1 id="unlock-title" className={cn(TYPE.title, "mt-6")}>
            Open your payslips
          </h1>
          <p className="mt-2 max-w-[46ch] text-[0.9375rem] text-muted-foreground">
            Your payer sent you a viewing key. Paste it on the lines below, open the key file, or scan its QR code.
          </p>

          {lockReason ? (
            <div
              role="alert"
              className="mt-5 flex items-start gap-2.5 border-2 border-destructive px-3.5 py-3 text-[0.8125rem] text-foreground"
            >
              <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
              <span>{lockReason}</span>
            </div>
          ) : null}

          <form onSubmit={submit} noValidate className="mt-7 space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <Label htmlFor="portal-key" className="whitespace-nowrap">
                Enter your viewing key
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
            {/* Ruled lines, no box: the key is typed onto the form the way a typewriter fills a field. */}
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
              className="min-h-[6.4em] border-x-0 border-t-0 border-b-2 border-foreground px-0.5 text-[0.875rem] break-all md:text-[0.875rem]"
              aria-invalid={showStatus && (result.kind !== "ufvk" || mismatch)}
              aria-describedby="portal-key-status"
            />
            {/* Always the same room, so the button below never moves while it is being clicked. */}
            <div className="min-h-11" aria-live="polite">
              {showStatus ? (
                <KeyStatus result={result} serviceNetwork={health?.network} id="portal-key-status" />
              ) : (
                <p id="portal-key-status" className="text-[0.8125rem] text-muted-foreground">
                  A full viewing key starts with <span className="font-type">uviewtest</span> or{" "}
                  <span className="font-type">uvftest</span> on testnet, <span className="font-type">uview</span> or{" "}
                  <span className="font-type">uvf</span> on mainnet.
                </p>
              )}
            </div>
            {fileError ? (
              <p role="alert" className="flex items-start gap-2 text-[0.8125rem] text-danger">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>{fileError}</span>
              </p>
            ) : null}
            {choices ? (
              <fieldset className="border border-foreground px-3.5 pt-2 pb-3.5">
                <legend className="form-label px-1 text-[0.75rem] font-bold">Whose payslips?</legend>
                <p className="mb-3 text-[0.8125rem] text-muted-foreground">
                  This file holds <span className="font-type">{choices.length}</span> contractor keys. Open one at a
                  time.
                </p>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {choices.map((k, i) => (
                    <button
                      key={k.ufvk}
                      type="button"
                      onClick={() => open(k.ufvk, { label: k.label, birthday: k.birthday ?? null })}
                      className="flex items-center gap-2.5 text-left font-type text-[0.9375rem] hover:underline"
                    >
                      <TypedBox />
                      {k.label ?? `Key ${i + 1}`}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null}
            <Button type="submit" size="lg" className="w-full" disabled={raw.trim() === ""}>
              Open payslips
            </Button>
          </form>
          {health?.network === "testnet" ? (
            <div className="mt-6 border-t border-dashed border-tear pt-4">
              <p className="form-label text-[0.75rem] text-muted-foreground">No key to hand</p>
              {/* A typed option on the form: the box gets its X while the demo key opens. */}
              <button
                type="button"
                onClick={() => void openDemo()}
                disabled={demoBusy}
                data-testid="portal-demo-key"
                className="mt-2.5 flex w-full items-start gap-2.5 text-left font-type text-[0.9375rem] leading-[1.35] hover:underline disabled:no-underline"
              >
                <TypedBox checked={demoBusy} className="mt-[1px]" />
                <span>
                  {demoBusy ? "Opening the demo key" : `Try it with a demo key (${DEMO_PERSON}, from the judge kit)`}
                </span>
              </button>
            </div>
          ) : null}

          <p className="mt-6 flex items-start gap-2.5 border-t border-foreground pt-4 text-[0.8125rem] text-muted-foreground">
            <KeyRound className="mt-0.5 size-4 shrink-0 text-foreground" aria-hidden="true" />
            Your viewing key reads payments to you. It cannot move money.
          </p>
        </div>
      </Sheet>
      <p className="mx-auto mt-4 max-w-[560px] px-2 text-[0.8125rem] text-muted-foreground">
        The key stays in this browser tab and is sent only to the Payslip service, which keeps a read-only scan of your
        payments so the next visit is quick. Lock forgets it here; you can also ask the service to forget it.
      </p>

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
