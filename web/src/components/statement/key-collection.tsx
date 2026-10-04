"use client";

import { useRef, useState } from "react";
import { FileJson, ScanLine, Trash2 } from "lucide-react";
import { ScanDialog } from "@/components/keys/scan-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { Network } from "@/lib/api";
import { networkLabel } from "@/lib/format";
import { classifyKey, keyPreview, splitKeys, type KeyClassification } from "@/lib/keys";
import { cn } from "cn";

export interface CollectedKey {
  raw: string;
  /** Label from an imported file. Shown here only, never sent. */
  label: string | null;
  source: "paste" | "file" | "scan";
  result: KeyClassification;
}

function dedupe(keys: CollectedKey[]): CollectedKey[] {
  const seen = new Set<string>();
  return keys.filter((k) => {
    const id = k.result.kind === "ufvk" ? k.result.value : k.raw.trim();
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Parse the payer's export file (GET /api/viewing-keys). */
function parseExport(text: string): { keys: { ufvk: string; label: string }[]; network: string } {
  const data = JSON.parse(text) as unknown;
  if (typeof data !== "object" || data === null || !Array.isArray((data as { keys?: unknown }).keys)) {
    throw new Error(
      "This file is not a Payslip viewing key export. Ask the payer for the file from Contractors, Export all viewing keys.",
    );
  }
  const d = data as { network?: unknown; keys: unknown[] };
  const keys = d.keys.flatMap((k) => {
    if (typeof k !== "object" || k === null) return [];
    const entry = k as { ufvk?: unknown; label?: unknown };
    return typeof entry.ufvk === "string"
      ? [{ ufvk: entry.ufvk, label: typeof entry.label === "string" ? entry.label : "" }]
      : [];
  });
  if (keys.length === 0) throw new Error("The file has no viewing keys in it. Ask the payer to export again.");
  return { keys, network: typeof d.network === "string" ? d.network : "" };
}

/** Every key from the paste box plus imported and scanned keys, deduplicated. */
export function collectKeys(pasted: string, extra: CollectedKey[]): CollectedKey[] {
  const fromPaste = splitKeys(pasted).map((raw) => ({
    raw,
    label: null,
    source: "paste" as const,
    result: classifyKey(raw),
  }));
  return dedupe([...extra, ...fromPaste]);
}

export function KeyCollection({
  pasted,
  onPastedChange,
  extra,
  onExtraChange,
  serviceNetwork,
}: {
  pasted: string;
  onPastedChange: (text: string) => void;
  extra: CollectedKey[];
  onExtraChange: (keys: CollectedKey[]) => void;
  serviceNetwork?: Network;
}) {
  const [fileMessage, setFileMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const keys = collectKeys(pasted, extra);

  const remove = (k: CollectedKey) => {
    if (k.source === "paste") {
      onPastedChange(
        pasted
          .split("\n")
          .filter((line) => line.trim() !== k.raw.trim())
          .join("\n"),
      );
    } else {
      onExtraChange(extra.filter((e) => e !== k));
    }
  };

  const onFile = async (file: File) => {
    setFileMessage(null);
    try {
      const parsed = parseExport(await file.text());
      const added = parsed.keys.map((k) => ({
        raw: k.ufvk,
        label: k.label || null,
        source: "file" as const,
        result: classifyKey(k.ufvk),
      }));
      onExtraChange(dedupe([...extra, ...added]));
      setFileMessage({
        ok: true,
        text: `Loaded ${added.length} keys from ${file.name}${parsed.network ? ` (${parsed.network})` : ""}.`,
      });
    } catch (err) {
      setFileMessage({
        ok: false,
        text:
          err instanceof SyntaxError
            ? "This file is not valid JSON. Use the .json file the payer exported."
            : (err as Error).message,
      });
    }
  };

  const valid = keys.filter(
    (k) => k.result.kind === "ufvk" && (!serviceNetwork || k.result.network === serviceNetwork),
  );

  return (
    <div className="space-y-4">
      <Tabs defaultValue="paste">
        <TabsList aria-label="How to add viewing keys">
          <TabsTrigger value="paste">Paste</TabsTrigger>
          <TabsTrigger value="file">Import file</TabsTrigger>
          <TabsTrigger value="scan">Scan QR</TabsTrigger>
        </TabsList>
        <TabsContent value="paste" className="space-y-2 pt-2">
          <Label htmlFor="accountant-paste">Viewing keys, one per line</Label>
          <Textarea
            id="accountant-paste"
            value={pasted}
            onChange={(e) => onPastedChange(e.target.value)}
            rows={5}
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            aria-describedby="accountant-paste-help"
            className="max-h-60 font-mono text-xs break-all"
          />
          <p id="accountant-paste-help" className="text-xs text-muted-foreground">
            Each key is checked as you paste and listed below. Spending keys and seed phrases are refused here and never
            sent.
          </p>
        </TabsContent>
        <TabsContent value="file" className="space-y-2 pt-2">
          <p className="text-sm text-muted-foreground">
            The payer exports one JSON file from Contractors, Export all viewing keys. Labels in the file are shown here
            but only the keys are sent to the service.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = "";
            }}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <FileJson aria-hidden="true" />
            Choose export file
          </Button>
          {fileMessage ? (
            <p
              role={fileMessage.ok ? "status" : "alert"}
              className={cn("text-sm", fileMessage.ok ? "text-success" : "text-danger")}
            >
              {fileMessage.text}
            </p>
          ) : null}
        </TabsContent>
        <TabsContent value="scan" className="space-y-2 pt-2">
          <p className="text-sm text-muted-foreground">Scan one key at a time. Each scan is added to the list below.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setScanOpen(true)}>
            <ScanLine aria-hidden="true" />
            Scan a QR code
          </Button>
        </TabsContent>
      </Tabs>

      <ScanDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        onResult={(v) =>
          onExtraChange(dedupe([...extra, { raw: v.trim(), label: null, source: "scan", result: classifyKey(v) }]))
        }
      />

      <div className="rounded-lg border">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2 text-xs text-muted-foreground">
          <span>
            {valid.length} of {keys.length} {keys.length === 1 ? "key" : "keys"} ready
          </span>
          {keys.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onPastedChange("");
                onExtraChange([]);
              }}
            >
              Clear all
            </Button>
          ) : null}
        </div>
        {keys.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted-foreground">
            No keys yet. Add the treasury key and every contractor key to reconcile complete runs.
          </p>
        ) : (
          <ul className="max-h-72 divide-y overflow-y-auto">
            {keys.map((k, i) => {
              const mismatch = k.result.kind === "ufvk" && serviceNetwork && k.result.network !== serviceNetwork;
              return (
                <li key={`${k.raw}-${i}`} className="flex items-start gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      {k.label ? <span className="font-medium">{k.label}</span> : null}
                      <code className="font-mono text-xs text-muted-foreground">{keyPreview(k.raw.trim())}</code>
                    </div>
                    {k.result.kind === "rejected" ? (
                      <p className="text-xs text-danger">{k.result.reason}</p>
                    ) : mismatch ? (
                      <p className="text-xs text-danger">
                        {networkLabel(k.result.network)} key, but the service runs on {serviceNetwork}. It will not be
                        sent.
                      </p>
                    ) : (
                      <p className="text-xs text-success">
                        Viewing key, {networkLabel(k.result.network).toLowerCase()}
                      </p>
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => remove(k)}
                    aria-label={`Remove ${k.label ?? keyPreview(k.raw.trim())}`}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

export function readyKeys(keys: CollectedKey[], serviceNetwork?: Network): string[] {
  return keys.flatMap((k) =>
    k.result.kind === "ufvk" && (!serviceNetwork || k.result.network === serviceNetwork) ? [k.result.value] : [],
  );
}
