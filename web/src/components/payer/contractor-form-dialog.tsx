"use client";

import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { describedBy, Field } from "@/components/app/field";
import { useHealth } from "@/components/app/health-provider";
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
import { NativeSelect } from "@/components/ui/native-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  api,
  toDisplayError,
  type ApiError,
  type Contractor,
  type NewContractor,
  type SettlementChoice,
} from "@/lib/api";
import { checkEvmAddress, checkUnifiedAddress, PAYOUT_CHAINS } from "@/lib/addresses";

type Errors = Partial<Record<"name" | "email" | "unified_address" | "payout_address" | "form", string>>;

const FIELD_FOR_CODE: Record<string, keyof Errors> = {
  invalid_address: "unified_address",
  address_without_shielded_receiver: "unified_address",
  duplicate_address: "unified_address",
  payout_address_required: "payout_address",
};

export function ContractorFormDialog({
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
  const { health } = useHealth();
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
    if (!name.trim()) e.name = "Enter the contractor's name as it should appear on statements.";
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      e.email = "Enter a valid email address, or leave it empty.";
    const ua = checkUnifiedAddress(address, health?.network);
    if (ua) e.unified_address = ua;
    if (settlement === "convert_usdc") {
      const evm = checkEvmAddress(payoutAddress);
      if (evm) e.payout_address = evm;
    }
    return e;
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) {
      const first = Object.keys(e)[0];
      document.getElementById(`${uid}-${first}`)?.focus();
      return;
    }
    const body: NewContractor = {
      name: name.trim(),
      unified_address: address.trim(),
      settlement_choice: settlement,
      ...(email.trim() ? { email: email.trim() } : {}),
      ...(settlement === "convert_usdc" ? { payout_chain: payoutChain, payout_address: payoutAddress.trim() } : {}),
    };
    setSubmitting(true);
    try {
      const saved = contractor ? await api.updateContractor(contractor.id, body) : await api.createContractor(body);
      toast.success(contractor ? `Saved ${saved.name}` : `Added ${saved.name} on account ${saved.account_index}`);
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
    health?.network === "mainnet"
      ? "Starts with u1. Copy it from the contractor's Zcash wallet."
      : "Starts with utest1 on testnet. Copy it from the contractor's Zcash wallet.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <form onSubmit={onSubmit} noValidate className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{contractor ? `Edit ${contractor.name}` : "Add contractor"}</DialogTitle>
            <DialogDescription>
              {contractor
                ? `Account ${contractor.account_index} stays the same, so their viewing key does not change.`
                : "Payslip creates a dedicated account for this contractor. Its viewing key will show their payments and nothing else."}
            </DialogDescription>
          </DialogHeader>

          <Field id={id("name")} label="Name" error={errors.name}>
            <Input
              id={id("name")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              maxLength={120}
              aria-invalid={!!errors.name}
              aria-describedby={describedBy(id("name"), errors.name)}
            />
          </Field>

          <Field
            id={id("email")}
            label="Email"
            optional
            error={errors.email}
            help="Only used to label the contractor. Payslip sends no email."
          >
            <Input
              id={id("email")}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
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
              className="font-mono text-xs break-all"
              aria-invalid={!!errors.unified_address}
              aria-describedby={describedBy(id("unified_address"), errors.unified_address, true)}
            />
          </Field>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Settlement</legend>
            <RadioGroup
              value={settlement}
              onValueChange={(v) => setSettlement(v as SettlementChoice)}
              className="gap-2"
            >
              <label
                htmlFor={id("hold")}
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[[data-state=checked]]:border-primary-edge"
              >
                <RadioGroupItem id={id("hold")} value="hold_zec" className="mt-0.5" />
                <span className="space-y-0.5">
                  <span className="block text-sm font-medium">Hold ZEC</span>
                  <span className="block text-xs text-muted-foreground">
                    Paid in shielded ZEC and kept in their own wallet. Most private.
                  </span>
                </span>
              </label>
              <label
                htmlFor={id("convert")}
                className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 has-[[data-state=checked]]:border-primary-edge"
              >
                <RadioGroupItem id={id("convert")} value="convert_usdc" className="mt-0.5" />
                <span className="space-y-0.5">
                  <span className="block text-sm font-medium">Convert to USDC</span>
                  <span className="block text-xs text-muted-foreground">
                    Paid in ZEC and swapped to USDC through NEAR Intents, then sent to the payout address. Less private:
                    the venue&apos;s public explorer shows this payment&apos;s amount and the USDC address.
                  </span>
                </span>
              </label>
            </RadioGroup>
          </fieldset>

          {settlement === "convert_usdc" ? (
            <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
              <div className="space-y-1.5">
                <Label htmlFor={id("chain")}>Payout chain</Label>
                <NativeSelect id={id("chain")} value={payoutChain} onChange={(e) => setPayoutChain(e.target.value)}>
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
                  placeholder="0x"
                  spellCheck={false}
                  autoComplete="off"
                  className="font-mono text-xs"
                  aria-invalid={!!errors.payout_address}
                  aria-describedby={describedBy(id("payout_address"), errors.payout_address)}
                />
              </Field>
            </div>
          ) : null}

          {errors.form ? (
            <p role="alert" className="rounded-md bg-danger-bg p-3 text-sm text-danger">
              {errors.form}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
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
