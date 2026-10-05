"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, EyeOff, Printer } from "lucide-react";
import { Usd, Zec } from "@/components/app/amount";
import { Field, describedBy } from "@/components/app/field";
import { Hash } from "@/components/app/hash";
import { ErrorState, PageHeader, Panel, Stat } from "@/components/app/states";
import { Badge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, toDisplayError, type ApiError, type VerifiedProof } from "@/lib/api";
import { formatDateTime, formatHeight, formatPeriodLabel, networkLabel } from "@/lib/format";

const QrCode = dynamic(() => import("@/components/app/qr-code"), { ssr: false });

/** The proof travels in the URL fragment (#pp1...), which browsers never send to the web host. */
function tokenFromHash(): string {
  if (typeof window === "undefined") return "";
  return decodeURIComponent(window.location.hash.replace(/^#/, "")).trim();
}

export function VerifyProofView() {
  const [token, setToken] = useState("");
  const [draft, setDraft] = useState("");
  const [address, setAddress] = useState("");
  const [checkedAddress, setCheckedAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [proof, setProof] = useState<VerifiedProof | null>(null);

  const verify = useCallback(async (t: string, addr: string) => {
    if (!t) return;
    setLoading(true);
    setError(null);
    try {
      setProof(await api.verifyProof(t, addr.trim() || undefined));
      setCheckedAddress(addr.trim());
    } catch (err) {
      setProof(null);
      setError(toDisplayError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const read = () => {
      const t = tokenFromHash();
      setToken(t);
      setDraft(t);
      if (t) void verify(t, "");
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [verify]);

  const submitToken = (event: React.FormEvent) => {
    event.preventDefault();
    const t = draft.trim().replace(/^.*#/, "");
    if (!t) return;
    window.history.replaceState(null, "", `#${t}`);
    setToken(t);
    void verify(t, address);
  };

  const submitAddress = (event: React.FormEvent) => {
    event.preventDefault();
    void verify(token, address);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          proof
            ? proof.memo.kind === "pay_line"
              ? `Payslip for ${formatPeriodLabel(proof.memo.period)}`
              : "Payslip"
            : "Verify a payment"
        }
        description="A Payslip payment proof opens one shielded Zcash payment and nothing else. This page fetches the transaction from the chain and checks the proof against it."
        actions={
          proof ? (
            <Button variant="outline" onClick={() => window.print()}>
              <Printer aria-hidden="true" />
              Print / Save as PDF
            </Button>
          ) : undefined
        }
      />

      {!token ? (
        <Panel title="Paste a payment proof" bodyClassName="p-4">
          <form onSubmit={submitToken} className="space-y-3">
            <Field id="proof" label="Proof link or code" help="It starts with pp1, or is a link ending in #pp1...">
              <Input
                id="proof"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-describedby={describedBy("proof", null, true)}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
              />
            </Field>
            <Button type="submit" disabled={!draft.trim()}>
              Verify payment
            </Button>
          </form>
        </Panel>
      ) : null}

      {loading && !proof ? <VerifySkeleton /> : null}
      {error ? <ErrorState error={error} onRetry={token ? () => void verify(token, address) : undefined} /> : null}
      {proof ? (
        <ProofResult proof={proof} checkedAddress={checkedAddress}>
          <form onSubmit={submitAddress} className="space-y-3">
            <Field
              id="expected-address"
              label="Check the address it was paid to"
              optional
              help="Paste the unified address you expected the payment to go to."
            >
              <Input
                id="expected-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                aria-describedby={describedBy("expected-address", null, true)}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
              />
            </Field>
            <Button type="submit" variant="outline" disabled={!address.trim() || loading}>
              {loading ? "Checking..." : "Check address"}
            </Button>
          </form>
        </ProofResult>
      ) : null}
    </div>
  );
}

function ProofResult({
  proof,
  checkedAddress,
  children,
}: {
  proof: VerifiedProof;
  checkedAddress: string;
  children: React.ReactNode;
}) {
  const memo = proof.memo;
  const mined = proof.height !== null;
  return (
    <>
      <section aria-labelledby="proof-status" className="rounded-lg border border-success/30 bg-success-bg p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <BadgeCheck className="mt-0.5 size-6 shrink-0 text-success" aria-hidden="true" />
          <div className="min-w-0 space-y-1">
            <h2 id="proof-status" className="text-lg font-semibold">
              {mined ? "Payment verified on chain" : "Payment found, not yet mined"}
            </h2>
            <p className="text-sm text-muted-foreground">
              Zcash {networkLabel(proof.network)}, shielded {proof.pool === "ironwood" ? "Ironwood" : "Orchard"} pool.
              {proof.confirmations ? ` ${proof.confirmations.toLocaleString("en-US")} confirmations.` : ""}
            </p>
          </div>
        </div>
        <dl className="mt-5 grid gap-5 sm:grid-cols-2">
          <Stat label="Amount" size="lg">
            <Zec zat={proof.amount_zat} />
          </Stat>
          <Stat label="Paid on">{proof.block_time ? formatDateTime(proof.block_time) : "Not yet mined"}</Stat>
        </dl>
      </section>

      {memo.kind === "pay_line" ? (
        <Panel
          title="Pay line"
          description={
            proof.network === "testnet"
              ? "Written by the payer in the payment's encrypted memo. Testnet runs use a fixed rate, so the USD figure does not match a market price for this TAZ amount."
              : "Written by the payer in the payment's encrypted memo."
          }
          bodyClassName="p-4"
        >
          <dl className="grid gap-4 sm:grid-cols-3">
            <Stat label="Period">{formatPeriodLabel(memo.period)}</Stat>
            <Stat label="Invoice">{memo.invoice_ref}</Stat>
            <Stat label="USD agreed">
              <Usd cents={memo.usd_basis_cents} />
            </Stat>
          </dl>
        </Panel>
      ) : (
        <Panel title="Memo" bodyClassName="p-4">
          <p className="text-sm break-words">
            {memo.kind === "text" ? memo.text : memo.kind === "none" ? "No memo." : "An internal Payslip record."}
          </p>
        </Panel>
      )}

      <Panel title="Transaction" bodyClassName="p-4">
        <dl className="grid gap-4">
          <Stat label="Transaction id">
            <Hash value={proof.txid} label="transaction id" explorerUrl={proof.explorer_url} head={12} tail={10} />
          </Stat>
          <Stat label="Block height">{formatHeight(proof.height)}</Stat>
          <Stat label="Paid to">
            <span className="flex flex-wrap items-center gap-2">
              <Hash value={proof.recipient} label="address" head={12} tail={8} />
              {proof.address_valid === false ? (
                <Badge tone="warning">Could not read the address you entered</Badge>
              ) : proof.address_matches === true ? (
                <Badge tone="success">Matches the address you entered</Badge>
              ) : proof.address_matches === false ? (
                <Badge tone="danger">Not the address you entered</Badge>
              ) : null}
            </span>
          </Stat>
        </dl>
        {proof.address_valid === false && checkedAddress ? (
          <p className="mt-3 text-sm text-warning" role="status">
            That is not a unified address on Zcash {networkLabel(proof.network).toLowerCase()}. Paste the full address,
            starting with {proof.network === "mainnet" ? "u1" : "utest1"}.
          </p>
        ) : proof.address_matches === false && checkedAddress ? (
          <p className="mt-3 text-sm text-danger" role="status">
            The payment went to a different shielded receiver than {checkedAddress.slice(0, 12)}... holds.
          </p>
        ) : null}
        <div className="mt-5 border-t pt-4" data-print="hide">
          {children}
        </div>
      </Panel>

      <Panel title="What this proof shows" bodyClassName="p-4">
        <div className="flex items-start gap-3 text-sm">
          <EyeOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p>
            This one payment: its amount, the address it was paid to and its memo. Not the sender, not any other payment
            by the same payer or to the same person, and no viewing key. The block explorer shows this transaction with
            no amount and no parties.
          </p>
        </div>
      </Panel>

      <section data-print="only" aria-hidden="true" className="flex items-center gap-4 border-t pt-4">
        <QrCode
          value={typeof window === "undefined" ? "" : window.location.href}
          label="Verify this payment"
          size={112}
        />
        <p className="text-sm">
          Scan to check this payment against the Zcash chain. The check needs no account and shows this payment only.
        </p>
      </section>
    </>
  );
}

function VerifySkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <span className="sr-only" role="status">
        Fetching the transaction and checking the proof
      </span>
      <Skeleton className="h-36 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}
