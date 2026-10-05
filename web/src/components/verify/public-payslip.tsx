"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  CalendarDays,
  Check,
  CircleDollarSign,
  Download,
  ExternalLink,
  LoaderCircle,
  MessageSquareText,
  RotateCw,
  ShieldCheck,
  SquareStack,
} from "lucide-react";
import { Usd, Zec } from "@/components/app/amount";
import { CopyButton } from "@/components/app/copy-button";
import { Tag } from "@/components/ds/tag";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, UNREACHABLE_CODE, api, toDisplayError, type VerifiedProof } from "@/lib/api";
import {
  formatDate,
  formatDateTime,
  formatPeriodLabel,
  formatUsd,
  formatZec,
  networkLabel,
  truncateMiddle,
} from "@/lib/format";
import { cn } from "cn";
import styles from "./public-payslip.module.css";

const QrCode = dynamic(() => import("@/components/app/qr-code"), { ssr: false });

/** A4 paper, and the dark theme's surfaces back to paper colours when printing. */
const PRINT_CSS = `@media print {
  @page { size: A4; margin: 16mm 15mm; }
  .dark {
    --strong: #222222; --raised: #ffffff; --chip: #eeeeee; --hairline: #cccccc; --card-foreground: #000000;
  }
}`;
const RETRY_MS = 1500;

/** The proof travels in the URL fragment (#pp1...), which browsers never send to the web host. */
function tokenFromHash(): string {
  try {
    return decodeURIComponent(window.location.hash.replace(/^#/, "")).trim();
  } catch {
    return window.location.hash.replace(/^#/, "").trim();
  }
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
        title: "The payment in this proof is not on the chain yet.",
        body: "If it was sent in the last few minutes, try again shortly. Otherwise ask the sender for a new link.",
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
 * One card on a soft grid, after Mercury's public invoice page.
 */
export function PublicPayslip() {
  /** null until the fragment has been read in the browser. */
  const [token, setToken] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [address, setAddress] = useState("");
  const [checkedAddress, setCheckedAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [proof, setProof] = useState<VerifiedProof | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

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
      if (!addr.trim()) setProof(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const read = () => {
      const t = tokenFromHash();
      setToken(t);
      setProof(null);
      setError(null);
      setAddress("");
      setCheckedAddress("");
      if (t) void verify(t, "");
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [verify]);

  const open = (raw: string) => {
    const t = raw.trim().replace(/^.*#/, "");
    if (!t) return;
    window.history.replaceState(null, "", `#${t}`);
    setToken(t);
    setProof(null);
    void verify(t, "");
  };

  const reset = () => {
    window.history.replaceState(null, "", window.location.pathname);
    setToken("");
    setDraft("");
    setProof(null);
    setError(null);
    setAddress("");
    setCheckedAddress("");
  };

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
        checkedAt={checkedAt}
        address={address}
        setAddress={setAddress}
        checkedAddress={checkedAddress}
        checking={loading}
        addressError={error}
        onCheckAddress={() => void verify(token, address)}
      />
    );
  } else if (error) {
    const plain = explain(error);
    body = (
      <>
        <Title>We could not check this payslip</Title>
        <div role="alert" className="rounded-[10px] bg-danger-bg px-4 py-3.5">
          <p className="text-[0.9375rem] text-foreground">{plain.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{plain.body}</p>
        </div>
        {plain.retry ? (
          <Button variant="secondary" className="mt-4" onClick={() => void verify(token, "")} disabled={loading}>
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

  return (
    <div className={styles.page}>
      <style>{PRINT_CSS}</style>
      <div className={styles.card}>{body}</div>
      <footer className={styles.foot}>
        {proof ? (
          <p>This payment was sent with Payslip, private payroll on Zcash.</p>
        ) : (
          <p>Payslip is private payroll on Zcash.</p>
        )}
        <p data-print="hide">
          <Link href="/" className="rounded-sm text-link hover:underline">
            About Payslip
          </Link>
          {token ? (
            <>
              <span aria-hidden="true"> · </span>
              <button type="button" onClick={reset} className="rounded-sm text-link hover:underline">
                Check another payslip
              </button>
            </>
          ) : null}
        </p>
      </footer>
    </div>
  );
}

function Title({ children }: { children: ReactNode }) {
  return (
    <h1 className="mb-6 text-[1.75rem] leading-[1.15] font-[380] tracking-[-0.015em] text-balance sm:text-[1.875rem]">
      {children}
    </h1>
  );
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
  checkedAt,
  address,
  setAddress,
  checkedAddress,
  checking,
  addressError,
  onCheckAddress,
}: {
  proof: VerifiedProof;
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
  const mined = proof.height !== null;
  const title = payLine ? `Payslip for ${formatPeriodLabel(payLine.period)}` : "Payment proof";
  const n = proof.confirmations ?? 0;

  const print = () => {
    const previous = document.title;
    document.title = title;
    window.print();
    document.title = previous;
  };

  return (
    <>
      <Title>{title}</Title>

      <section aria-label="Amount" className="overflow-hidden rounded-lg border bg-raised px-5 pt-[22px] pb-0 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[1.625rem] leading-tight font-[380]">
              {payLine ? <Usd cents={payLine.usd_basis_cents} /> : <Zec zat={proof.amount_zat} />}
            </p>
            {payLine ? (
              <p className="mt-1 text-[0.8125rem] text-muted-foreground">
                <Zec zat={proof.amount_zat} />
                {testnet ? (
                  <span title="Testnet runs use a fixed rate, not a market price."> · Simulated rate</span>
                ) : null}
              </p>
            ) : null}
          </div>
          {payLine ? (
            <span className="shrink-0 pt-1 font-mono text-[0.8125rem] text-strong">{payLine.invoice_ref}</span>
          ) : null}
        </div>
        {mined ? (
          <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-success">
            <Check className="size-4" aria-hidden="true" />
            Verified on Zcash{testnet ? " testnet" : ""} · {n.toLocaleString("en-US")}{" "}
            {n === 1 ? "confirmation" : "confirmations"}
          </p>
        ) : (
          <p className="mt-2 inline-flex items-center gap-1.5 text-sm text-warning">
            <LoaderCircle className="size-4" aria-hidden="true" />
            Found on Zcash{testnet ? " testnet" : ""}, waiting to be mined
          </p>
        )}
        <Thumb proof={proof} title={title} />
        <div className="hidden h-4 print:block" aria-hidden="true" />
      </section>

      <button
        type="button"
        onClick={print}
        className="mt-6 flex h-[42px] w-full items-center justify-center gap-2 rounded-lg border bg-card text-[0.9375rem] text-foreground transition-colors hover:bg-muted"
      >
        <Download className="size-4 text-link" aria-hidden="true" />
        Download payslip
      </button>

      <section aria-labelledby="shows" className="mt-[34px]">
        <h2 id="shows" className="text-base font-normal">
          What this proof shows
        </h2>
        <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">
          {checkedAt ? `Checked ${formatDateTime(checkedAt)} against the Zcash chain. ` : ""}Nothing else about the
          payer or the contractor is revealed.
        </p>
        <ul className="mt-3.5 rounded-lg border">
          <Shows icon={CircleDollarSign} label="Amount">
            {payLine ? <Usd cents={payLine.usd_basis_cents} /> : <Zec zat={proof.amount_zat} />}
          </Shows>
          <Shows icon={CalendarDays} label="Paid on">
            {proof.block_time ? formatDateTime(proof.block_time) : "Not yet mined"}
          </Shows>
          <Shows icon={ShieldCheck} label="Paid to">
            <span className="inline-flex flex-wrap items-center justify-end gap-x-1 gap-y-1">
              <code className="font-mono text-[0.8125rem]" title={proof.recipient}>
                <span data-print="hide">{truncateMiddle(proof.recipient, 10, 5)}</span>
                <span data-print="only" className="break-all">
                  {proof.recipient}
                </span>
              </code>
              <CopyButton value={proof.recipient} label="address" />
            </span>
          </Shows>
          <Shows icon={SquareStack} label="Transaction">
            <a
              href={proof.explorer_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-sm font-mono text-[0.8125rem] hover:underline"
              title={`${proof.txid} (opens a block explorer in a new tab)`}
            >
              <span data-print="hide">{truncateMiddle(proof.txid, 8, 4)}</span>
              <span data-print="only" className="break-all">
                {proof.txid}
              </span>
              <ExternalLink className="size-3.5 text-muted-foreground" aria-hidden="true" data-print="hide" />
            </a>
          </Shows>
          {memo.kind === "text" ? (
            <Shows icon={MessageSquareText} label="Memo">
              <span className="break-words">{memo.text}</span>
            </Shows>
          ) : null}
        </ul>
        <p className="mt-3 text-[0.8125rem] text-muted-foreground">
          A block explorer shows this transaction with no amount and no parties. This proof opens only this payment.
        </p>
      </section>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onCheckAddress();
        }}
        className="mt-8 space-y-2 border-t border-hairline pt-6"
        data-print="hide"
      >
        <label htmlFor="expected-address" className="block text-[0.9375rem]">
          Check the address it was paid to <span className="text-muted-foreground">(optional)</span>
        </label>
        <p id="expected-address-help" className="text-[0.8125rem] text-muted-foreground">
          Paste the unified address you expected this payment to go to.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id="expected-address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder={testnet ? "utest1…" : "u1…"}
            className="h-10 font-mono"
            aria-describedby="expected-address-help expected-address-result"
          />
          <Button type="submit" variant="secondary" size="lg" disabled={!address.trim() || checking}>
            {checking ? "Checking" : "Check address"}
          </Button>
        </div>
        <div id="expected-address-result" aria-live="polite">
          {addressError && checkedAddress !== address.trim() ? (
            <p className="text-sm text-destructive">{explain(addressError).title}</p>
          ) : !checkedAddress ? null : proof.address_valid === false ? (
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

      <section data-print="only" className="mt-6 border-t pt-4">
        <div className="flex items-center gap-4">
          <QrCode
            value={typeof window === "undefined" ? "" : window.location.href}
            label="Check this payment"
            size={96}
          />
          <p className="text-xs">
            Scan to check this payment against the Zcash chain. The check needs no account and shows this payment only.
          </p>
        </div>
      </section>
    </>
  );
}

function Shows({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
  label: string;
  children: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[30px_minmax(0,1fr)] items-center gap-x-2 gap-y-1 border-b border-hairline px-4 py-3.5 text-[0.9375rem] last:border-b-0 sm:grid-cols-[30px_auto_minmax(0,1fr)] sm:px-[18px]">
      <span
        aria-hidden="true"
        className="grid size-[26px] place-items-center rounded-full border text-muted-foreground"
      >
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <span className="text-strong">{label}</span>
      <span className="col-start-2 min-w-0 text-left text-foreground sm:col-start-3 sm:text-right">{children}</span>
    </li>
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
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

/** A small paper payslip under the amount, like Mercury's invoice thumbnail. Decorative. */
function Thumb({ proof, title }: { proof: VerifiedProof; title: string }) {
  const memo = proof.memo.kind === "pay_line" ? proof.memo : null;
  return (
    <div className={styles.thumb} aria-hidden="true" data-print="hide">
      <p className="text-[10px] font-medium">{memo ? "Payslip" : title}</p>
      <div className={styles.thumbLine} style={{ width: "55%" }} />
      <div className={styles.thumbLine} />
      <div className={styles.thumbLine} style={{ width: "40%", height: 4, background: "#F4B728" }} />
      {memo ? (
        <div className={styles.thumbRow}>
          <span>Period</span>
          <span>{formatPeriodLabel(memo.period)}</span>
        </div>
      ) : null}
      <div className={styles.thumbRow}>
        <span>Amount</span>
        <span>{memo ? formatUsd(memo.usd_basis_cents) : formatZec(proof.amount_zat)}</span>
      </div>
      <div className={styles.thumbRow}>
        <span>Paid</span>
        <span>{proof.block_time ? formatDate(proof.block_time) : "Pending"}</span>
      </div>
      <div className={styles.thumbLine} />
      <div className={styles.thumbLine} style={{ width: "55%" }} />
    </div>
  );
}
