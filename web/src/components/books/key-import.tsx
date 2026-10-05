"use client";

import { useRef, useState } from "react";
import { Building2, FileJson, OctagonAlert, ScanLine, TriangleAlert } from "lucide-react";
import { useHealth } from "@/components/app/health-provider";
import { ScanDialog } from "@/components/keys/scan-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, toDisplayError, type ApiError } from "@/lib/api";
import { networkLabel } from "@/lib/format";
import { classifyKey, keyPreview, splitKeys } from "@/lib/keys";
import { parseKeyFile, usableKeys, type BookKey, type StagedKey } from "@/components/books/books-data";
import { cn } from "cn";

type Message = { tone: "ok" | "error"; text: string; hint?: string };

/**
 * Three ways in: the company's key file, keys pasted one per line, or a QR code. On a full
 * deployment the company's own keys load with one button, so a visitor pastes nothing.
 */
export function KeyImport({
  onAdd,
  primary = false,
  idPrefix,
}: {
  onAdd: (keys: BookKey[]) => void;
  /** Make the first action the screen's gold primary (the setup card). */
  primary?: boolean;
  idPrefix: string;
}) {
  const { health } = useHealth();
  const network = health?.network;
  const full = !!health && health.mode !== "statements";
  const [pasted, setPasted] = useState("");
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const staged: StagedKey[] = splitKeys(pasted).map((raw) => ({
    raw,
    label: null,
    role: null,
    result: classifyKey(raw),
  }));
  const ready = usableKeys(staged, network);
  const problems = staged.filter(
    (k) => k.result.kind === "rejected" || (network && k.result.kind === "ufvk" && k.result.network !== network),
  );

  const commit = (keys: StagedKey[], source: string) => {
    const usable = usableKeys(keys, network);
    const wrongNetwork = keys.filter((k) => k.result.kind === "ufvk" && network && k.result.network !== network);
    if (usable.length === 0) {
      setMessage({
        tone: "error",
        text: wrongNetwork.length
          ? `These keys are for ${networkLabel(wrongNetwork[0].result.kind === "ufvk" ? wrongNetwork[0].result.network : "").toLowerCase()}, but this service runs on ${network}.`
          : "None of these are viewing keys.",
        hint: "Use the key file the company exported from this deployment.",
      });
      return;
    }
    onAdd(usable);
    const skipped = keys.length - usable.length;
    setMessage({
      tone: "ok",
      text: `Added ${usable.length} ${usable.length === 1 ? "key" : "keys"} from ${source}.${skipped ? ` ${skipped} could not be used.` : ""}`,
    });
  };

  const loadCompany = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const file = await api.viewingKeyExport();
      commit(
        file.keys.map((k) => ({ raw: k.ufvk, label: k.label || null, role: k.role, result: classifyKey(k.ufvk) })),
        "this company",
      );
    } catch (err) {
      const e: ApiError = toDisplayError(err);
      setMessage({ tone: "error", text: e.message, hint: e.hint });
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File) => {
    setMessage(null);
    try {
      const parsed = parseKeyFile(await file.text());
      commit(parsed.keys, file.name);
    } catch (err) {
      setMessage({ tone: "error", text: (err as Error).message });
    }
  };

  const addPasted = () => {
    if (ready.length === 0) return;
    onAdd(ready);
    // Keep only the lines that could not be used, so their reasons stay visible.
    setPasted(problems.map((p) => p.raw).join("\n"));
    setMessage({ tone: "ok", text: `Added ${ready.length} ${ready.length === 1 ? "key" : "keys"}.` });
  };

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap gap-2">
        {full ? (
          <Button
            type="button"
            variant={primary ? "default" : "secondary"}
            onClick={() => void loadCompany()}
            disabled={busy}
          >
            <Building2 aria-hidden="true" />
            {busy ? "Loading keys" : "Load this company's keys"}
          </Button>
        ) : null}
        <Button
          type="button"
          variant={primary && !full ? "default" : "secondary"}
          onClick={() => fileRef.current?.click()}
        >
          <FileJson aria-hidden="true" />
          Import key file
        </Button>
        <Button type="button" variant="secondary" onClick={() => setScanOpen(true)}>
          <ScanLine aria-hidden="true" />
          Scan a QR code
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          tabIndex={-1}
          aria-label="Key file"
          data-testid={`${idPrefix}-file`}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
            e.target.value = "";
          }}
        />
      </div>

      {message ? (
        <div role={message.tone === "ok" ? "status" : "alert"} className="text-sm">
          <p className={message.tone === "ok" ? "text-success" : "text-destructive"}>{message.text}</p>
          {message.hint ? <p className="mt-0.5 text-muted-foreground">{message.hint}</p> : null}
        </div>
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-paste`} className="font-normal text-strong">
          Or paste viewing keys, one per line
        </Label>
        <Textarea
          id={`${idPrefix}-paste`}
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          rows={3}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          placeholder={network === "mainnet" ? "uview1…" : "uviewtest1…"}
          className="max-h-48 min-h-[84px] font-mono text-xs break-all"
          aria-describedby={problems.length ? `${idPrefix}-problems` : undefined}
        />
        {problems.length ? (
          <ul id={`${idPrefix}-problems`} className="grid gap-1.5">
            {problems.map((p, i) => {
              const spending = p.result.kind === "rejected" && p.result.spending;
              const Icon = spending ? OctagonAlert : TriangleAlert;
              const reason =
                p.result.kind === "rejected"
                  ? p.result.reason
                  : `A ${networkLabel(p.result.network).toLowerCase()} key, but this service runs on ${network}.`;
              return (
                <li key={`${p.raw}-${i}`} className="flex items-start gap-2 text-sm text-destructive">
                  <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>
                    <code className="font-mono text-xs text-muted-foreground">{keyPreview(p.raw)}</code> {reason}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="secondary" size="sm" onClick={addPasted} disabled={ready.length === 0}>
            {ready.length > 0 ? `Add ${ready.length} ${ready.length === 1 ? "key" : "keys"}` : "Add keys"}
          </Button>
          <span className={cn("text-xs text-muted-foreground", staged.length === 0 && "sr-only")}>
            {ready.length} of {staged.length} ready. Spending keys and seed phrases are refused here and never sent.
          </span>
        </div>
      </div>

      <ScanDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        onResult={(v) => {
          setPasted((p) => (p.trim() ? `${p.trim()}\n${v.trim()}` : v.trim()));
          setMessage({ tone: "ok", text: "Scanned. The key is in the box below; add it when you have them all." });
        }}
      />
    </div>
  );
}
