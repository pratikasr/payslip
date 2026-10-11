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
import { TYPE } from "@/components/ds/type";
import { cn } from "cn";
import { parseUsdToCents, usdAmountProblem } from "@/lib/format";
import {
  api,
  toDisplayError,
  type ApiError,
  type Contractor,
  type NewContractor,
  type SettlementChoice,
} from "@/lib/api";

type Errors = Partial<
  Record<"name" | "email" | "unified_address" | "payout_address" | "default_amount" | "form", string>
>;

const FIELD_FOR_CODE: Record<string, keyof Errors> = {
  invalid_default_amount: "default_amount",
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
  const [defaultAmount, setDefaultAmount] = useState("");
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
    setDefaultAmount(
      contractor?.default_amount_usd_cents ? (contractor.default_amount_usd_cents / 100).toFixed(2) : "",
    );
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
    const typed = defaultAmount.trim();
    if (typed) {
      const cents = parseUsdToCents(typed);
      if (cents === null) e.default_amount = usdAmountProblem(typed) ?? "Check this amount.";
      else if (cents <= 0) e.default_amount = "The default amount must be more than zero, or empty.";
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
      // Editing always sends it: empty clears a default amount that was set.
      ...(defaultAmount.trim()
        ? { default_amount_usd_cents: parseUsdToCents(defaultAmount.trim()) ?? 0 }
        : contractor
          ? { default_amount_usd_cents: null }
          : {}),
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
            <DialogTitle className={cn(TYPE.heading, "[overflow-wrap:anywhere]")}>
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
                className="font-type text-[0.8125rem] break-all"
                aria-invalid={!!errors.unified_address}
                aria-describedby={describedBy(id("unified_address"), errors.unified_address, true)}
              />
            </Field>

            <fieldset className="grid gap-2">
              <legend className="form-label mb-2 text-[0.75rem] font-bold">Settlement</legend>
              <RadioGroup
                value={settlement}
                onValueChange={(v) => setSettlement(v as SettlementChoice)}
                className="gap-2"
              >
                <label
                  htmlFor={id("hold")}
                  className="flex cursor-pointer items-start gap-3 border border-rule p-3.5 transition-colors has-[[data-state=checked]]:border-2 has-[[data-state=checked]]:border-ink has-[[data-state=checked]]:bg-bar has-[[data-state=checked]]:p-[13px]"
                >
                  <RadioGroupItem id={id("hold")} value="hold_zec" className="mt-0.5" />
                  <span className="grid gap-0.5">
                    <span className="font-type text-[0.9375rem] font-bold">Hold {coin}</span>
                    <span className="text-[0.8125rem] text-muted-foreground">
                      Paid in shielded {coin} to their own wallet. Most private.
                    </span>
                  </span>
                </label>
                <label
                  htmlFor={id("convert")}
                  className="flex cursor-pointer items-start gap-3 border border-rule p-3.5 transition-colors has-[[data-state=checked]]:border-2 has-[[data-state=checked]]:border-ink has-[[data-state=checked]]:bg-bar has-[[data-state=checked]]:p-[13px]"
                >
                  <RadioGroupItem id={id("convert")} value="convert_usdc" className="mt-0.5" />
                  <span className="grid gap-0.5">
                    <span className="font-type text-[0.9375rem] font-bold">Convert to USDC</span>
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
                    className="h-10 font-type text-[0.8125rem]"
                    aria-invalid={!!errors.payout_address}
                    aria-describedby={describedBy(id("payout_address"), errors.payout_address)}
                  />
                </Field>
              </div>
            ) : null}

            <Field
              id={id("default_amount")}
              label="Default amount (USD)"
              optional
              error={errors.default_amount}
              help="What a scheduled payroll pays them, unless they send a request for the period."
            >
              <div className="relative">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-1 -translate-y-1/2 font-type text-[0.9375rem] text-muted-foreground"
                >
                  $
                </span>
                <Input
                  id={id("default_amount")}
                  inputMode="decimal"
                  autoComplete="off"
                  value={defaultAmount}
                  placeholder="0.00"
                  onChange={(e) => setDefaultAmount(e.target.value)}
                  className="money h-10 pl-5 text-right tracking-normal"
                  aria-invalid={!!errors.default_amount}
                  aria-describedby={describedBy(id("default_amount"), errors.default_amount, true)}
                />
              </div>
            </Field>

            {errors.form ? (
              <p role="alert" className="border border-destructive bg-danger-bg p-3 text-[0.8125rem] text-danger">
                {errors.form}
              </p>
            ) : null}
          </div>

          <DialogFooter className="mx-0 mb-0 px-6 py-4">
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
