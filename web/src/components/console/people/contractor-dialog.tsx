"use client";

import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { describedBy, Field } from "@/components/app/field";
import { useCoinUnit, useHealth } from "@/components/app/health-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { checkPayoutAddress, checkUnifiedAddress, normaliseUnifiedAddress, PAYOUT_CHAINS } from "@/lib/addresses";
import {
  api,
  toDisplayError,
  type ApiError,
  type Contractor,
  type NewContractor,
  type SettlementChoice,
} from "@/lib/api";

type Errors = Partial<Record<"name" | "email" | "unified_address" | "payout_address" | "form", string>>;

const FIELD_FOR_CODE: Record<string, keyof Errors> = {
  invalid_address: "unified_address",
  address_without_shielded_receiver: "unified_address",
  duplicate_address: "unified_address",
  payout_address_required: "payout_address",
  invalid_payout_address: "payout_address",
};

/**
 * Add or edit a contractor. The form logic follows the payer's original dialog (client checks
 * first, then the service's error codes mapped back onto the field they belong to).
 */
export function ContractorDialog({
  open,
  onOpenChange,
  contractor,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the dialog edits this contractor (PATCH); otherwise it adds one (POST). */
  contractor?: Contractor;
  onSaved: (c: Contractor) => void;
}) {
  const uid = useId();
  const { network } = useHealth();
  const coin = useCoinUnit();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [settlement, setSettlement] = useState<SettlementChoice>("hold_zec");
  const [payoutChain, setPayoutChain] = useState<string>("base");
  const [payoutAddress, setPayoutAddress] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(contractor?.name ?? "");
    setEmail(contractor?.email ?? "");
    setAddress(contractor?.unified_address ?? "");
    setSettlement(contractor?.settlement_choice ?? "hold_zec");
    setPayoutChain(contractor?.payout_chain ?? "base");
    setPayoutAddress(contractor?.payout_address ?? "");
    setErrors({});
  }, [open, contractor]);

  const validate = (): Errors => {
    const e: Errors = {};
    if (!name.trim()) e.name = "Enter the contractor's name as it should appear on payslips.";
    // The same rule as the service: something on each side of one "@". It is only a label.
    if (email.trim() && !/^[^\s@]+@[^\s@]+$/.test(email.trim()))
      e.email = "Enter a valid email address, or leave it empty.";
    const ua = checkUnifiedAddress(address, network);
    if (ua) e.unified_address = ua;
    if (settlement === "convert_usdc") {
      const payout = checkPayoutAddress(payoutAddress, payoutChain);
      if (payout) e.payout_address = payout;
    }
    return e;
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) {
      document.getElementById(`${uid}-${Object.keys(e)[0]}`)?.focus();
      return;
    }
    const body: NewContractor = {
      name: name.trim(),
      unified_address: normaliseUnifiedAddress(address),
      settlement_choice: settlement,
      // Editing always sends the email: an empty one clears it (the service stores none).
      ...(email.trim() || contractor ? { email: email.trim() } : {}),
      ...(settlement === "convert_usdc" ? { payout_chain: payoutChain, payout_address: payoutAddress.trim() } : {}),
    };
    setSubmitting(true);
    try {
      const saved = contractor ? await api.updateContractor(contractor.id, body) : await api.createContractor(body);
      toast.success(contractor ? `Saved ${saved.name}` : `Added ${saved.name}`);
      onSaved(saved);
      onOpenChange(false);
    } catch (err) {
      const apiErr: ApiError = toDisplayError(err);
      const field = FIELD_FOR_CODE[apiErr.code];
      const text = apiErr.hint ? `${apiErr.message} ${apiErr.hint}` : apiErr.message;
      setErrors(field ? { [field]: text } : { form: text });
    } finally {
      setSubmitting(false);
    }
  };

  const id = (f: string) => `${uid}-${f}`;
  const uaHelp =
    network === "mainnet"
      ? "Starts with u1. Copy it from the contractor's Zcash wallet."
      : "Starts with utest1 on testnet. Copy it from the contractor's Zcash wallet.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-[520px]">
        <form onSubmit={onSubmit} noValidate className="grid">
          <DialogHeader className="gap-1.5 px-6 pt-6 pb-2">
            <DialogTitle className="text-[1.1875rem] leading-tight font-[380] tracking-[-0.01em] [overflow-wrap:anywhere]">
              {contractor ? `Edit ${contractor.name}` : "Add contractor"}
            </DialogTitle>
            <DialogDescription className="text-[0.9375rem]">
              {contractor
                ? "Their private account stays the same, so their viewing key does not change."
                : "Payslip opens a private account for this person. Its viewing key shows their payments and nothing else."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 px-6 pt-4 pb-6">
            <Field id={id("name")} label="Name" error={errors.name}>
              <Input
                id={id("name")}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
                maxLength={120}
                className="h-10"
                aria-invalid={!!errors.name}
                aria-describedby={describedBy(id("name"), errors.name)}
              />
            </Field>

            <Field
              id={id("email")}
              label="Email"
              optional
              error={errors.email}
              help="Only a label. Payslip sends no email."
            >
              <Input
                id={id("email")}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
                className="h-10"
                aria-invalid={!!errors.email}
                aria-describedby={describedBy(id("email"), errors.email, true)}
              />
            </Field>

            <Field id={id("unified_address")} label="Unified address" error={errors.unified_address} help={uaHelp}>
              <Textarea
                id={id("unified_address")}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                rows={3}
                spellCheck={false}
                autoComplete="off"
                className="font-mono text-[0.8125rem] break-all"
                aria-invalid={!!errors.unified_address}
                aria-describedby={describedBy(id("unified_address"), errors.unified_address, true)}
              />
            </Field>

            <fieldset className="grid gap-2">
              <legend className="mb-2 text-[0.8125rem] font-medium">Settlement</legend>
              <RadioGroup
                value={settlement}
                onValueChange={(v) => setSettlement(v as SettlementChoice)}
                className="gap-2"
              >
                <label
                  htmlFor={id("hold")}
                  className="flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors has-[[data-state=checked]]:border-primary-edge has-[[data-state=checked]]:bg-primary-soft/40"
                >
                  <RadioGroupItem id={id("hold")} value="hold_zec" className="mt-0.5" />
                  <span className="grid gap-0.5">
                    <span className="text-[0.9375rem]">Hold {coin}</span>
                    <span className="text-[0.8125rem] text-muted-foreground">
                      Paid in shielded {coin} to their own wallet. Most private.
                    </span>
                  </span>
                </label>
                <label
                  htmlFor={id("convert")}
                  className="flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors has-[[data-state=checked]]:border-primary-edge has-[[data-state=checked]]:bg-primary-soft/40"
                >
                  <RadioGroupItem id={id("convert")} value="convert_usdc" className="mt-0.5" />
                  <span className="grid gap-0.5">
                    <span className="text-[0.9375rem]">Convert to USDC</span>
                    <span className="text-[0.8125rem] text-muted-foreground">
                      Swapped to USDC through NEAR Intents and sent to their payout address. Less private: the
                      venue&apos;s explorer shows the amount and the USDC address.
                    </span>
                  </span>
                </label>
              </RadioGroup>
            </fieldset>

            {settlement === "convert_usdc" ? (
              <div className="grid gap-4 sm:grid-cols-[9rem_minmax(0,1fr)]">
                <div className="space-y-1.5">
                  <Label htmlFor={id("chain")}>Payout chain</Label>
                  <NativeSelect
                    id={id("chain")}
                    value={payoutChain}
                    onChange={(e) => setPayoutChain(e.target.value)}
                    className="h-10"
                  >
                    {PAYOUT_CHAINS.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <Field id={id("payout_address")} label="Payout address" error={errors.payout_address}>
                  <Input
                    id={id("payout_address")}
                    value={payoutAddress}
                    onChange={(e) => setPayoutAddress(e.target.value)}
                    placeholder={payoutChain === "sol" ? "Solana address" : "0x"}
                    spellCheck={false}
                    autoComplete="off"
                    className="h-10 font-mono text-[0.8125rem]"
                    aria-invalid={!!errors.payout_address}
                    aria-describedby={describedBy(id("payout_address"), errors.payout_address)}
                  />
                </Field>
              </div>
            ) : null}

            {errors.form ? (
              <p role="alert" className="rounded-lg bg-danger-bg p-3 text-[0.8125rem] text-danger">
                {errors.form}
              </p>
            ) : null}
          </div>

          <DialogFooter className="mx-0 mb-0 rounded-b-xl px-6 py-4">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving" : contractor ? "Save changes" : "Add contractor"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
