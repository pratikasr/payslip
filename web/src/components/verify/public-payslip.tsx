"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Check, Download, LoaderCircle, RotateCw } from "lucide-react";
import { Usd, Zec } from "@/components/app/amount";
import { CopyButton } from "@/components/app/copy-button";
import { Tag } from "@/components/ds/tag";
import {
  ChainFacts,
  PaperView,
  Redacted,
  Thread,
  TwoViews,
  TxidLines,
  VaultView,
  ViewField,
  ViewTitle,
} from "@/components/ds/two-views";
import { TYPE } from "@/components/ds/type";
import { useDocumentTitle } from "@/components/portal/document-title";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, UNREACHABLE_CODE, api, toDisplayError, type VerifiedProof } from "@/lib/api";
import { companyMark, companyName } from "@/lib/company";
import { formatDateTime, formatHeight, formatPeriodLabel, networkLabel, truncateMiddle } from "@/lib/format";
import { classifyKey } from "@/lib/keys";
import { cn } from "cn";
import styles from "./public-payslip.module.css";

const QrCode = dynamic(() => import("@/components/app/qr-code"), { ssr: false });

/** The two views sit side by side from 1024px; this page has no sidebar. */
const SPLIT = "lg" as const;

/** A4 paper, and the dark theme's surfaces back to paper colours when printing. */
const PRINT_CSS = `@media print {
  @page { size: A4; margin: 16mm 15mm; }
  .dark {
    --strong: #222222; --raised: #ffffff; --chip: #eeeeee; --hairline: #cccccc; --card-foreground: #000000;
  }
}`;
const RETRY_MS = 1500;

/** A proof token: pp1 then unpadded base64url (service/src/proof.rs). */
const TOKEN = /^pp1[A-Za-z0-9_-]{16,}$/;

/** What a link fragment holds: the proof, and an optional note from whoever shared it. */
interface Fragment {
  token: string;
  note: string | null;
}

/**
 * The proof travels in the URL fragment (#pp1...), which browsers never send to the web host. A
 * note the contractor added rides after it (&note=...), and is shown as theirs, not checked.
 */
function parseFragment(raw: string): Fragment {
  let text = raw.trim().replace(/^.*?#/, "");
  try {
    text = decodeURIComponent(text);
  } catch {
    /* leave it as it is; validation below decides */
  }
  const [token, ...rest] = text.split("&");
  const note = new URLSearchParams(rest.join("&")).get("note")?.trim();
  return { token: token.trim(), note: note ? note.slice(0, 120) : null };
}

/**
 * Checked before anything is sent: a viewing key, an invite link or other key material pasted
 * here must never reach the service in a URL.
 */
function localProblem(token: string): { title: string; body: string } | null {
  if (TOKEN.test(token)) return null;
  const candidate = token.replace(/^key=/, "");
  const key = classifyKey(candidate);
  if (token.startsWith("key=") || key.kind === "ufvk" || (key.kind === "rejected" && key.spending)) {
    return {
      title: "This is a key, not a payment proof. Nothing was sent.",
      body: "Keep it private: a key reads (or, for a spending key, moves) every payment of its account. A payment proof starts with pp1 and shows one payment only; ask the person paid to share one from their payslip.",
    };
  }
  return {
    title: "This is not a complete payslip proof.",
    body: "A proof starts with pp1. Part of the link may be missing; ask the person who sent it to copy the whole link again.",
  };
}

/** Checks a proof against the chain; a dropped lightwalletd connection is retried once first. */
async function check(token: string, address?: string): Promise<VerifiedProof> {
  try {
    return await api.verifyProof(token, address);
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== "lightwalletd_unreachable") throw err;
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    return api.verifyProof(token, address);
  }
}

/** Plain words for each way a proof can fail. */
function explain(e: ApiError): { title: string; body: string; retry: boolean } {
  switch (e.code) {
    case "invalid_proof":
      return {
        title: "This is not a complete payslip proof.",
        body: "Part of the link may be missing. Ask the person who sent it to copy the whole link again.",
        retry: false,
      };
    case "proof_mismatch":
      return {
        title: "This proof does not match the payment on the Zcash chain.",
        body: "It was changed after it was made, or it belongs to a different payment. Ask the sender for a new link.",
        retry: false,
      };
    case "wrong_network":
      return { title: "This proof is for a different Zcash network.", body: `${e.message} ${e.hint}`, retry: false };
    case "tx_not_found":
      return {
        title: "We could not find this payment on the Zcash chain.",
        body: "If it was sent in the last few minutes, try again. Otherwise the link is wrong or was changed; ask the sender for a new one.",
        retry: true,
      };
    case UNREACHABLE_CODE:
      return { title: "Payslip cannot reach its server right now.", body: "Try again in a moment.", retry: true };
    case "lightwalletd_unreachable":
      return {
        title: "The Zcash network could not be reached to check this proof.",
        body: "Try again in a moment.",
        retry: true,
      };
    default:
      return { title: "This proof could not be checked.", body: `${e.message} ${e.hint}`.trim(), retry: true };
  }
}

/**
 * The public payslip: what a landlord, bank or visa office opens from a contractor's proof link.
 * A checked proof opens in the identity's two views: what the world sees on the explorer beside
 * what the proof shows. Asking for a proof, checking it and its errors sit in one narrow sheet.
 */
export function PublicPayslip() {
  /** null until the fragment has been read in the browser. */
  const [frag, setFrag] = useState<Fragment | null>(null);
  const [draft, setDraft] = useState("");
  const [address, setAddress] = useState("");
  const [checkedAddress, setCheckedAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [problem, setProblem] = useState<{ title: string; body: string } | null>(null);
  const [proof, setProof] = useState<VerifiedProof | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const token = frag?.token ?? null;

  const verify = useCallback(async (t: string, addr: string) => {
    if (!t) return;
    setLoading(true);
    setError(null);
    try {
      setProof(await check(t, addr.trim() || undefined));
      setCheckedAddress(addr.trim());
      setCheckedAt(new Date().toISOString());
    } catch (err) {
      setError(toDisplayError(err));
      setCheckedAddress(addr.trim());
      if (!addr.trim()) setProof(null);
    } finally {
      setLoading(false);
    }
  }, []);

  /** Validates in the browser first; only a well-formed proof is sent to the service. */
  const start = useCallback(
    (f: Fragment) => {
      setFrag(f);
      setProof(null);
      setError(null);
      setAddress("");
      setCheckedAddress("");
      const p = f.token ? localProblem(f.token) : null;
      setProblem(p);
      // Key material leaves the address bar at once, so it is not kept in history or shared on.
      if (p && f.token) window.history.replaceState(null, "", window.location.pathname);
      if (f.token && !p) void verify(f.token, "");
    },
    [verify],
  );

  useEffect(() => {
    const read = () => start(parseFragment(window.location.hash));
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [start]);

  const open = (raw: string) => {
    const f = parseFragment(raw);
    if (!f.token) return;
    if (!localProblem(f.token)) {
      window.history.replaceState(null, "", `#${f.token}${f.note ? `&note=${encodeURIComponent(f.note)}` : ""}`);
    }
    start(f);
  };

  const reset = () => {
    window.history.replaceState(null, "", window.location.pathname);
    setFrag({ token: "", note: null });
    setDraft("");
    setProof(null);
    setError(null);
    setProblem(null);
    setAddress("");
    setCheckedAddress("");
  };

  const payTitle =
    proof && proof.memo.kind === "pay_line" ? `Payslip for ${formatPeriodLabel(proof.memo.period)}` : "Payment proof";
  useDocumentTitle(proof ? `${payTitle} | Payslip` : "Check a payslip | Payslip");

  let body: ReactNode;
  if (token === null) {
    body = <Skeleton className="h-64 w-full" />;
  } else if (!token) {
    body = (
      <>
        <Title>Check a payslip</Title>
        <p className="-mt-3 mb-6 text-[0.9375rem] text-muted-foreground">
          Paste the proof link or code you were sent. Payslip checks it against the Zcash chain; you need no account.
        </p>
        <PasteForm draft={draft} setDraft={setDraft} onSubmit={open} primary />
      </>
    );
  } else if (proof) {
    body = (
      <ProofView
        proof={proof}
        title={payTitle}
        note={frag?.note ?? null}
        checkedAt={checkedAt}
        address={address}
        setAddress={setAddress}
        checkedAddress={checkedAddress}
        checking={loading}
        addressError={error}
        onCheckAddress={() => void verify(token, address)}
      />
    );
  } else if (problem || error) {
    const plain = problem ? { ...problem, retry: false } : explain(error as ApiError);
    body = (
      <>
        <Title>We could not check this payslip</Title>
        <div role="alert" className="rounded-[10px] bg-danger-bg px-4 py-3.5">
          <p className="text-[0.9375rem] text-foreground">{plain.title}</p>
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">{plain.body}</p>
        </div>
        {plain.retry ? (
          <Button
            variant="secondary"
            size="sm"
            className="mt-4"
            onClick={() => void verify(token, "")}
            disabled={loading}
          >
            <RotateCw aria-hidden="true" />
            {loading ? "Checking" : "Try again"}
          </Button>
        ) : null}
        <div className="mt-8 border-t border-hairline pt-6" data-print="hide">
          <PasteForm draft={draft} setDraft={setDraft} onSubmit={open} label="Check a different link" />
        </div>
      </>
    );
  } else {
    body = (
      <>
        <Title>Checking this payslip</Title>
        <p role="status" className="flex items-start gap-2.5 text-[0.9375rem] text-muted-foreground">
          <LoaderCircle className="mt-1 size-4 shrink-0 animate-spin text-foreground" aria-hidden="true" />
          Fetching the transaction from the Zcash chain and checking the proof against it
        </p>
        <Skeleton className="mt-6 h-[260px] w-full rounded-lg" />
      </>
    );
  }

  const Mark = companyMark();
  return (
    <div className={styles.page}>
      <style>{PRINT_CSS}</style>
      <div className={proof ? styles.wide : styles.card}>
        {/* The masthead names the issuer and the company it was issued for, on screen and on paper. */}
        <p className="mb-5 flex items-start gap-2 text-[0.8125rem] text-muted-foreground" data-testid="verify-issuer">
          <Mark className="mt-px size-5 shrink-0 text-foreground" />
          <span className="text-pretty">
            Payment proof issued through <span className="text-foreground">Payslip</span> for{" "}
            <span className="font-display font-[600] text-foreground">{companyName()}</span>
          </span>
        </p>
        {body}
      </div>
      <footer className={styles.foot}>
        {proof ? (
          <p>Checked by Payslip, private payroll on Zcash, against the public chain.</p>
        ) : (
          <p>Payslip is private payroll on Zcash.</p>
        )}
        <p data-print="hide">
          <Link href="/" className="rounded-sm text-link underline underline-offset-4">
            About Payslip
          </Link>
          {token ? (
            <>
              {" "}
              or{" "}
              <button type="button" onClick={reset} className="rounded-sm text-link underline underline-offset-4">
                check another payslip
              </button>
            </>
          ) : null}
        </p>
      </footer>
    </div>
  );
}

function Title({ children }: { children: ReactNode }) {
  return <h1 className={cn(TYPE.title, "mb-6 text-balance")}>{children}</h1>;
}

function PasteForm({
  draft,
  setDraft,
  onSubmit,
  label = "Proof link or code",
  primary,
}: {
  draft: string;
  setDraft: (v: string) => void;
  onSubmit: (v: string) => void;
  label?: string;
  primary?: boolean;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(draft);
      }}
      className="space-y-2"
    >
      <label htmlFor="proof-input" className="block text-[0.9375rem]">
        {label}
      </label>
      <Input
        id="proof-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        placeholder="pp1…"
        className="h-10 font-mono"
        aria-describedby="proof-input-help"
      />
      <p id="proof-input-help" className="text-[0.8125rem] text-muted-foreground">
        It starts with pp1, or is a link ending in #pp1…
      </p>
      <Button
        type="submit"
        variant={primary ? "default" : "secondary"}
        size="lg"
        className={cn("mt-2", primary && "w-full")}
        disabled={!draft.trim()}
      >
        Check payslip
      </Button>
    </form>
  );
}

function ProofView({
  proof,
  title,
  note,
  checkedAt,
  address,
  setAddress,
  checkedAddress,
  checking,
  addressError,
  onCheckAddress,
}: {
  proof: VerifiedProof;
  title: string;
  note: string | null;
  checkedAt: string | null;
  address: string;
  setAddress: (v: string) => void;
  checkedAddress: string;
  checking: boolean;
  addressError: ApiError | null;
  onCheckAddress: () => void;
}) {
  const memo = proof.memo;
  const payLine = memo.kind === "pay_line" ? memo : null;
  const testnet = proof.network === "testnet";
  // Older services send no `mined`; a height means the transaction is in a block.
  const mined = proof.mined ?? proof.height !== null;
  const n = proof.confirmations ?? 0;
  const net = `Zcash${testnet ? " testnet" : ""}`;
  // A result belongs to the address it was checked with; editing the field clears it.
  const current = checkedAddress !== "" && checkedAddress === address.trim();
  const host = explorerHost(proof.explorer_url);

  const print = () => {
    const previous = document.title;
    document.title = title;
    window.print();
    document.title = previous;
  };

  return (
    <>
      <Title>{title}</Title>
      {mined ? (
        <p
          className="-mt-3 mb-7 inline-flex items-center gap-1.5 text-[0.9375rem] text-success"
          data-testid="verify-status"
        >
          <Check className="size-4" aria-hidden="true" />
          Verified on {net}, {n.toLocaleString("en-US")} {n === 1 ? "confirmation" : "confirmations"}
        </p>
      ) : (
        <p
          className="-mt-3 mb-7 inline-flex items-center gap-1.5 text-[0.9375rem] text-warning"
          data-testid="verify-status"
        >
          <LoaderCircle className="size-4" aria-hidden="true" />
          Found on {net}, not yet confirmed. Check again once it is in a block.
        </p>
      )}

      {/*
        The payment two ways, joined by its txid: what anyone sees on the explorer, and what this
        proof opens. Side by side from 1024px; stacked, and printed, the explorer's view first.
      */}
      <TwoViews
        id="proof-views"
        rows={8}
        split={SPLIT}
        columns="aside"
        caption={`${title} in two views: what the world sees on the Zcash chain, and what this proof shows.`}
      >
        <VaultView labelledBy="world-title" split={SPLIT}>
          <ViewTitle id="world-title" title="What the world sees">
            {mined ? (
              <>
                A shielded transaction in block <span className="num">{formatHeight(proof.height)}</span>: no amount, no
                names.
              </>
            ) : (
              "A shielded transaction waiting for a block: no amount, no names."
            )}
          </ViewTitle>
          <div className="flex items-center pb-5">
            <p className="font-mono text-[0.8125rem] leading-[1.5] break-all text-ink">
              <TxidLines txid={proof.txid} />
            </p>
            <Thread side="vault" split={SPLIT} className="ml-4" />
          </div>
          <ChainFacts height={proof.height} time={proof.block_time} />
          <ViewField label="Amount">
            <Redacted className="w-[3.9em] text-[1.875rem] lg:text-[2.75rem]" />
            <Redacted className="mt-1 w-[9em] text-[0.8125rem]" />
          </ViewField>
          <ViewField label="Sender">
            <Redacted className="w-[8em] text-[0.9375rem]" />
          </ViewField>
          <ViewField label="Recipient">
            <Redacted className="w-[min(100%,19ch)] font-mono text-[0.8125rem]" />
          </ViewField>
          <ViewField label="Memo">
            <Redacted className="w-[min(100%,12em)] text-[0.9375rem]" />
          </ViewField>
          <p className="border-t border-mist pt-5 text-[0.9375rem]" data-print="hide">
            <a
              href={proof.explorer_url}
              target="_blank"
              rel="noreferrer"
              data-txid={proof.txid}
              className="rounded-[3px] text-ink underline decoration-ink/40 decoration-1 underline-offset-[3px] transition-colors hover:decoration-gold"
            >
              {host ? `Open it on ${host}` : "Open it on a public block explorer"}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </p>
        </VaultView>

        <PaperView labelledBy="shows" split={SPLIT} className="print:rounded-none print:border-0 print:px-0 print:pb-0">
          <div className="pb-5">
            <h2 id="shows" className="text-[0.9375rem] font-medium">
              What this proof shows
            </h2>
            <p className="mt-1 text-[0.8125rem] leading-[1.45] text-ash">
              {checkedAt ? `Checked ${formatDateTime(checkedAt)} against the Zcash chain. ` : ""}
              {proof.proves ?? "Nothing else about the payer or the contractor is revealed."}
            </p>
          </div>
          <div className="flex items-center pb-5">
            <Thread side="paper" split={SPLIT} />
            <p className="min-w-0 font-mono text-[0.8125rem] leading-[1.5] break-all text-ink">
              <span className="sr-only">Transaction </span>
              <TxidLines txid={proof.txid} />
            </p>
          </div>
          <ChainFacts height={proof.height} time={proof.block_time} timeLabel="Paid" />
          <ViewField label="Amount">
            <span className={cn(TYPE.hero, "block")}>
              {payLine ? <Usd cents={payLine.usd_basis_cents} /> : <Zec zat={proof.amount_zat} />}
            </span>
            {payLine ? (
              <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-ash">
                <Zec zat={proof.amount_zat} />
                {testnet ? (
                  <span title="Testnet coins have no market price; testnet payrolls convert dollars at a fixed demo rate.">
                    at a simulated rate
                  </span>
                ) : null}
              </span>
            ) : null}
          </ViewField>
          <ViewField label="Sender">
            <span className="text-[0.9375rem]">Not shown</span>
            <span className="block text-[0.8125rem] text-ash">A payment proof does not say who sent it.</span>
          </ViewField>
          <ViewField label="Recipient">
            <span className="flex flex-wrap items-center gap-x-1">
              <code className="font-mono text-[0.8125rem] break-all" title={proof.recipient}>
                <span data-print="hide">{truncateMiddle(proof.recipient, 14, 8)}</span>
                <span data-print="only">{proof.recipient}</span>
              </code>
              <CopyButton value={proof.recipient} label="address" />
            </span>
            <span className="block text-[0.8125rem] text-ash">
              One receiver of the person&apos;s Zcash address, so it will not look identical to the full address they
              gave you.
            </span>
          </ViewField>
          <ViewField label="Memo">
            {payLine ? (
              <>
                <span className="text-[0.9375rem]">
                  {formatPeriodLabel(payLine.period)} pay, invoice{" "}
                  <span className="whitespace-nowrap">{payLine.invoice_ref}</span>
                </span>
                <span className="block text-[0.8125rem] text-ash">
                  The sender&apos;s own statement, written in the memo.
                </span>
              </>
            ) : memo.kind === "text" ? (
              <span className="text-[0.9375rem] break-words">{memo.text}</span>
            ) : (
              <span className="text-[0.9375rem] text-ash">No memo</span>
            )}
          </ViewField>
          <div className="border-t border-mist pt-5">
            {note ? (
              <p className="mb-5 rounded-lg border px-4 py-3 text-[0.9375rem]" data-testid="verify-note">
                <span className="block text-[0.8125rem] text-muted-foreground">
                  A note from the person who shared this, not checked by Payslip
                </span>
                <span className="break-words text-foreground">{note}</span>
              </p>
            ) : null}

            <Button type="button" variant="secondary" onClick={print} data-print="hide">
              <Download aria-hidden="true" />
              Download payslip
            </Button>

            <section aria-labelledby="check-address" className="mt-8 border-t border-mist pt-6" data-print="hide">
              <h2 id="check-address" className="text-[0.9375rem] font-medium">
                Check the address
              </h2>
              <p className="mt-1 text-[0.8125rem] text-muted-foreground">
                Paste the address the person gave you to check it holds the receiver this payment went to.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  onCheckAddress();
                }}
                className="mt-4 space-y-2"
              >
                <label htmlFor="expected-address" className="block text-[0.9375rem]">
                  Check the address it was paid to <span className="text-muted-foreground">(optional)</span>
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="expected-address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={testnet ? "utest1…" : "u1…"}
                    className="h-10 font-mono"
                    aria-describedby="expected-address-result"
                  />
                  <Button type="submit" variant="secondary" size="lg" disabled={!address.trim() || checking}>
                    {checking ? "Checking" : "Check address"}
                  </Button>
                </div>
                <div id="expected-address-result" aria-live="polite">
                  {!current ? null : addressError ? (
                    <p className="text-[0.8125rem] text-destructive">{explain(addressError).title}</p>
                  ) : proof.address_valid === false ? (
                    <AddressResult tone="warning" tag="Could not read the address you entered">
                      That is not a unified address on Zcash {networkLabel(proof.network).toLowerCase()}. Paste the full
                      address, starting with {testnet ? "utest1" : "u1"}.
                    </AddressResult>
                  ) : proof.address_matches === true ? (
                    <AddressResult tone="success" tag="Matches the address you entered">
                      The payment went to a receiver inside {truncateMiddle(checkedAddress, 10, 5)}.
                    </AddressResult>
                  ) : proof.address_matches === false ? (
                    <AddressResult tone="danger" tag="Not the address you entered">
                      The payment went to a different receiver than {truncateMiddle(checkedAddress, 10, 5)} holds.
                    </AddressResult>
                  ) : null}
                </div>
              </form>
            </section>

            <section aria-labelledby="not-proved" className="mt-8 border-t border-mist pt-6">
              <h2 id="not-proved" className="text-[0.9375rem] font-medium">
                What it does not prove
              </h2>
              <p className="mt-1 text-[0.8125rem] text-muted-foreground">
                {proof.does_not_prove ??
                  "Who sent it, or that it came from a Payslip payer. The memo was written by the sender and is not checked against any payroll record."}
              </p>
            </section>

            <section data-print="only" className="mt-6 border-t pt-4">
              <div className="flex items-center gap-4">
                <QrCode
                  value={typeof window === "undefined" ? "" : window.location.href}
                  label="Check this payment"
                  size={96}
                />
                <p className="text-[0.8125rem]">
                  Scan to check this payment against the Zcash chain. The check needs no account and shows this payment
                  only.
                </p>
              </div>
            </section>
          </div>
        </PaperView>
      </TwoViews>
    </>
  );
}

function AddressResult({
  tone,
  tag,
  children,
}: {
  tone: "success" | "warning" | "danger";
  tag: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-1 space-y-1.5" role="status">
      <Tag tone={tone}>{tag}</Tag>
      <p className="text-[0.8125rem] text-muted-foreground">{children}</p>
    </div>
  );
}

/** The explorer's host name from a transaction link, for "Open it on testnet.zecblock.com". */
function explorerHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
