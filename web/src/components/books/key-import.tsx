"use client";

import { useRef, useState, type ReactNode } from "react";
import { Building2, FileJson, FlaskConical, OctagonAlert, ScanLine, TriangleAlert } from "lucide-react";
import { useHealth } from "@/components/app/health-provider";
import { ScanDialog } from "@/components/keys/scan-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api, toDisplayError, type ApiError } from "@/lib/api";
import { networkLabel } from "@/lib/format";
import { classifyKey, keyPreview, splitKeys } from "@/lib/keys";
import { isPortalOrigin } from "@/lib/public-url";
import { useBooks } from "@/components/books/books-provider";
import { parseKeyFile, usableKeys, type StagedKey } from "@/components/books/books-data";
import { parseInvite } from "@/components/portal/portal-data";
import { cn } from "cn";

type Message = { tone: "ok" | "error"; text: string; hint?: string };

/** The judge kit published with the repository, served by the web app (web/public). */
export const JUDGE_KIT_URL = "/judge-kit-testnet.json";

/**
 * Ways in: the company's key file, the judge kit on testnet, keys pasted one per line, or a QR
 * code. On a full deployment the company's own keys load with one button, so a visitor pastes
 * nothing; on the contractors' portal origin that button is never offered.
 */
export function KeyImport({
  layout = "buttons",
  idPrefix,
}: {
  /** "rows": the setup card's full-width choices. "buttons": a compact row (Manage keys). */
  layout?: "rows" | "buttons";
  idPrefix: string;
}) {
  const { addKeys } = useBooks();
  const { health, error: healthError, loading: healthLoading } = useHealth();
  const network = health?.network;
  const portalOrigin = isPortalOrigin();
  // Unknown until health answers: the button shows disabled rather than appearing late.
  const companyKeys = !portalOrigin && (!health || health.mode !== "statements");
  const companyReady = !!health && health.mode !== "statements";
  const testnet = network === "testnet";
  const [pasted, setPasted] = useState("");
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const staged: StagedKey[] = splitKeys(pasted).map((raw) => {
    const invite = parseInvite(raw);
    return {
      raw,
      label: invite.meta.label,
      role: null,
      birthday: invite.meta.birthday,
      result: classifyKey(invite.key),
    };
  });
  const ready = usableKeys(staged, network);
  const problems = staged.filter(
    (k) => k.result.kind === "rejected" || (network && k.result.kind === "ufvk" && k.result.network !== network),
  );

  const added = (n: { added: number; already: number }, source: string, skipped = 0) => {
    const parts = [
      n.added === 0
        ? `No new keys from ${source}`
        : `Added ${n.added} ${n.added === 1 ? "key" : "keys"} from ${source}`,
    ];
    if (n.already) parts.push(`${n.already} already loaded`);
    if (skipped) parts.push(`${skipped} could not be used`);
    return `${parts.join(", ")}.`;
  };

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
    setMessage({ tone: "ok", text: added(addKeys(usable), source, keys.length - usable.length) });
  };

  const loadCompany = async () => {
    setBusy("company");
    setMessage(null);
    try {
      const file = await api.viewingKeyExport();
      commit(
        file.keys.map((k) => ({
          raw: k.ufvk,
          label: k.label || null,
          role: k.role,
          birthday: file.birthday_height || null,
          accountIndex: k.account_index,
          result: classifyKey(k.ufvk),
        })),
        "this company",
      );
    } catch (err) {
      const e: ApiError = toDisplayError(err);
      setMessage({ tone: "error", text: e.message, hint: e.hint });
    } finally {
      setBusy(null);
    }
  };

  const loadJudgeKit = async () => {
    setBusy("kit");
    setMessage(null);
    try {
      const res = await fetch(JUDGE_KIT_URL, { cache: "no-store" });
      if (!res.ok) throw new Error("The judge kit is not published on this deployment.");
      commit(parseKeyFile(await res.text()).keys, "the judge kit");
    } catch (err) {
      setMessage({ tone: "error", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const onFile = async (file: File) => {
    setMessage(null);
    try {
      commit(parseKeyFile(await file.text()).keys, file.name);
    } catch (err) {
      setMessage({ tone: "error", text: (err as Error).message });
    }
  };

  const addPasted = () => {
    if (ready.length === 0) return;
    const n = addKeys(ready);
    // Keep only the lines that could not be used, so their reasons stay visible.
    setPasted(problems.map((p) => p.raw).join("\n"));
    setMessage({ tone: "ok", text: added(n, "the pasted text") });
  };

  const offline = healthError && !health;
  const choices: Choice[] = [
    ...(companyKeys
      ? [
          {
            id: "company",
            icon: Building2,
            title: busy === "company" ? "Loading keys" : "Load this company's keys",
            hint: companyReady
              ? "Every account this deployment pays from and to, with names."
              : offline
                ? "Unavailable while the service cannot be reached."
                : "Checking the service.",
            onClick: () => void loadCompany(),
            disabled: !companyReady || busy !== null,
            primary: true,
          },
        ]
      : []),
    ...(testnet
      ? [
          {
            id: "kit",
            icon: FlaskConical,
            title: busy === "kit" ? "Loading the judge kit" : "Load the judge kit",
            hint: "The demo company's seven testnet keys, as published with Payslip.",
            onClick: () => void loadJudgeKit(),
            disabled: busy !== null,
            primary: !companyKeys,
          },
        ]
      : []),
    {
      id: "file",
      icon: FileJson,
      title: "Import a key file",
      hint: "The .json file the company exported from Payslip access.",
      onClick: () => fileRef.current?.click(),
      disabled: false,
      primary: !companyKeys && !testnet,
    },
    {
      id: "scan",
      icon: ScanLine,
      title: "Scan a QR code",
      hint: "A viewing key or a contractor's invite, by camera or photo.",
      onClick: () => setScanOpen(true),
      disabled: false,
      primary: false,
    },
  ];

  return (
    <div className="grid gap-5">
      {offline ? (
        <div role="alert" className="flex items-start gap-2.5 rounded-[10px] bg-danger-bg px-3.5 py-3 text-[0.8125rem]">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <span>
            Payslip cannot reach its service right now, so no keys can be read. {healthLoading ? "Checking again." : ""}
          </span>
        </div>
      ) : null}

      {layout === "rows" ? (
        <ul className="divide-y divide-hairline overflow-hidden rounded-xl border" aria-label="Ways to load keys">
          {choices.map((c) => (
            <li key={c.id}>
              <ChoiceRow choice={c} testId={`${idPrefix}-choice-${c.id}`} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-wrap gap-2">
          {choices.map((c) => (
            <Button
              key={c.id}
              type="button"
              variant="secondary"
              size="sm"
              onClick={c.onClick}
              disabled={c.disabled}
              data-testid={`${idPrefix}-choice-${c.id}`}
            >
              <c.icon aria-hidden="true" />
              {c.title}
            </Button>
          ))}
        </div>
      )}
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

      {message ? (
        <div role={message.tone === "ok" ? "status" : "alert"} className="text-[0.8125rem]">
          <p className={message.tone === "ok" ? "text-success" : "text-destructive"}>{message.text}</p>
          {message.hint ? <p className="mt-0.5 text-muted-foreground">{message.hint}</p> : null}
        </div>
      ) : null}

      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-paste`} className="font-normal text-strong">
          Or paste viewing keys or invite links, one per line
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
          className="max-h-48 min-h-[84px] font-mono text-[0.8125rem] break-all"
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
                <li key={`${p.raw}-${i}`} className="flex items-start gap-2 text-[0.8125rem] text-destructive">
                  <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>
                    <code className="font-mono text-[0.8125rem] text-muted-foreground">{keyPreview(p.raw)}</code>{" "}
                    {reason}
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
          <span className={cn("text-[0.8125rem] text-muted-foreground", staged.length === 0 && "sr-only")}>
            {ready.length} of {staged.length} ready. Spending keys and seed phrases are refused here and never sent.
          </span>
        </div>
      </div>

      <ScanDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        onResult={(v) => {
          // A contractor's invite QR holds a link; the key is in its #key= part.
          const invite = parseInvite(v);
          const result = classifyKey(invite.key);
          if (result.kind !== "ufvk") {
            setMessage({ tone: "error", text: `That QR code holds no viewing key. ${result.reason}` });
            return;
          }
          if (network && result.network !== network) {
            setMessage({
              tone: "error",
              text: `That QR code holds a ${networkLabel(result.network).toLowerCase()} key, but this service runs on ${network}.`,
            });
            return;
          }
          const line = invite.invite ? v.trim() : result.value;
          setPasted((p) => (p.trim() ? `${p.trim()}\n${line}` : line));
          setMessage({
            tone: "ok",
            text: `Scanned a viewing key${invite.meta.label ? ` for ${invite.meta.label}` : ""}. It is in the box below; add it when you have them all.`,
          });
        }}
      />
    </div>
  );
}

interface Choice {
  id: string;
  icon: typeof FileJson;
  title: string;
  hint: string;
  onClick: () => void;
  disabled: boolean;
  primary: boolean;
}

/** One full-width choice: an icon, what it does, one line on what it reads. */
function ChoiceRow({ choice: c, testId }: { choice: Choice; testId: string }): ReactNode {
  return (
    <button
      type="button"
      onClick={c.onClick}
      disabled={c.disabled}
      data-testid={testId}
      className="grid w-full grid-cols-[36px_minmax(0,1fr)_16px] items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
    >
      <span
        className={cn(
          "grid size-9 place-items-center rounded-full",
          c.primary ? "bg-primary text-primary-foreground" : "bg-chip text-strong",
        )}
      >
        <c.icon className="size-[18px]" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-[0.9375rem] text-foreground">{c.title}</span>
        <span className="block text-[0.8125rem] text-muted-foreground">{c.hint}</span>
      </span>
    </button>
  );
}
