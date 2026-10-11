"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { ArrowRightLeft, KeyRound, Lock, LockOpen, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { CopyButton } from "@/components/app/copy-button";
import { Field, describedBy } from "@/components/app/field";
import { useCoinUnit, useHealth } from "@/components/app/health-provider";
import { useAuth } from "@/components/auth/auth-provider";
import { Card, CardHeader } from "@/components/ds/card";
import { PageTitle } from "@/components/ds/page";
import { Sensitive } from "@/components/ds/sensitive";
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
import { useResource } from "@/hooks/use-resource";
import { checkUnifiedAddress, normaliseUnifiedAddress } from "@/lib/addresses";
import { api, isTreasuryLocked, toDisplayError, type ApiError, type TreasuryKey } from "@/lib/api";
import { formatDateTime, formatHeight, truncateMiddle } from "@/lib/format";
import { PASSPHRASE_MIN, PHRASE_WORDS, SCRYPT_WORK_FACTOR } from "@/lib/treasury-key";
import { cn } from "cn";
import { FormBox, TypedOption } from "@/components/portal/paper-parts";
import { Problem } from "@/components/runs/problem";
import { TreasuryKeyForm } from "./key-form";
import { KeyStateStamp, keyStateInfo } from "./status";
import { LockedPrompt, UnlockDialog } from "./unlock";

/*
  The treasury key page (/console/settings/treasury-key): its state, the address and birthday,
  how the key is protected, who can spend it in honest words, and the admin's actions: Unlock,
  Lock now, Replace key (the create or import flow again, then a sweep into the new treasury),
  Move treasury (everything to a shielded address outside Payslip). Every member reads it.
*/

/** The honest statement, word for word (the owner's requirement). */
export const WHO_CAN_SPEND = [
  "While locked, nobody can spend your treasury, including the operator of this server.",
  "While an admin has unlocked it for payroll, this server can sign payments; someone with root on the host could read the key from memory during that time.",
  "For full control, self-host Payslip; it is one command (deploy/README.md).",
];

type Panel = "replace" | "move" | null;

export function TreasuryKeyView({ initial }: { initial: { key?: TreasuryKey } }) {
  const auth = useAuth();
  const router = useRouter();
  const { treasury, setTreasury } = useHealth();
  const key = useResource((s) => api.treasuryKey(s), "treasury-key", initial.key);
  const admin = auth.can("manage_treasury_key");
  const [unlocking, setUnlocking] = useState(false);
  const [locking, setLocking] = useState(false);
  const [lockProblem, setLockProblem] = useState<ApiError | null>(null);
  const [panel, setPanel] = useState<Panel>(null);

  const k = key.data;
  // The state the service reports now, by whichever answered last (health polls, the page reads).
  const state = k?.state ?? treasury;
  const apply = (next: TreasuryKey) => {
    key.setData(next);
    setTreasury(next.state);
  };

  const lock = async () => {
    setLocking(true);
    setLockProblem(null);
    try {
      apply(await api.lockTreasury());
      toast.success("Treasury locked", { description: "Nobody can spend it until an admin unlocks it again." });
    } catch (err) {
      setLockProblem(toDisplayError(err));
    } finally {
      setLocking(false);
    }
  };

  return (
    <>
      <PageTitle
        title="Treasury key"
        back={
          <Link href="/console/settings" className="hover:text-foreground">
            Settings
          </Link>
        }
        description="The key that spends your treasury: where it is, how it is protected, and who can use it."
      />
      {key.error && !k ? (
        key.error.status === 404 ? (
          <Problem
            error={{
              message: "This Payslip service does not manage its treasury key from the console.",
              hint: "It was started with a seed file and PAYSLIP_SEED_PASSPHRASE. Update the service to create, lock and unlock the key from here.",
              status: 404,
            }}
          />
        ) : (
          <Problem error={key.error} title="Could not read the treasury key" onRetry={key.reload} />
        )
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Card aria-labelledby="key-state-title" data-testid="treasury-key-state">
          <CardHeader
            id="key-state-title"
            title="Status"
            actions={<KeyStateStamp state={state} until={k?.unlocked_until} />}
          />
          <p className="mt-2 text-[0.8125rem] text-muted-foreground">
            {keyStateInfo(state, k?.unlocked_until).sentence}
          </p>
          <dl className="green-bar mt-4 border-y-2 border-ink font-type text-[0.9375rem] [&>div]:grid [&>div]:grid-cols-[minmax(7rem,auto)_minmax(0,1fr)] [&>div]:items-start [&>div]:gap-x-4 [&>div]:px-2.5 [&>div]:py-2">
            <div>
              <dt className="form-label text-[0.75rem] font-bold text-muted-foreground">State</dt>
              <dd data-testid="treasury-key-state-word">{keyStateInfo(state, k?.unlocked_until).label}</dd>
            </div>
            {state === "unlocked" ? (
              <div>
                <dt className="form-label text-[0.75rem] font-bold text-muted-foreground">Unlocked until</dt>
                <dd>{k?.unlocked_until ? formatDateTime(k.unlocked_until) : "Not reported"}</dd>
              </div>
            ) : null}
            <div>
              <dt className="form-label text-[0.75rem] font-bold text-muted-foreground">Address</dt>
              <dd className="min-w-0">
                {k?.address ? (
                  <span className="flex min-w-0 items-center gap-1">
                    <Sensitive className="min-w-0 truncate">
                      <code className="font-type" title={k.address} data-testid="treasury-key-address">
                        {truncateMiddle(k.address, 14, 10)}
                      </code>
                    </Sensitive>
                    <CopyButton value={k.address} label="treasury address" />
                  </span>
                ) : (
                  <span className="text-muted-foreground">None yet</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="form-label text-[0.75rem] font-bold text-muted-foreground">Birthday</dt>
              <dd className="num">
                {k?.birthday_height ? (
                  <>
                    Block {formatHeight(k.birthday_height)}
                    <span className="block font-sans text-[0.8125rem] text-muted-foreground">
                      A scan of the treasury starts here; nothing earlier belongs to it.
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">Not set</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="form-label text-[0.75rem] font-bold text-muted-foreground">Created</dt>
              <dd>
                {k?.created_at ? formatDateTime(k.created_at) : <span className="text-muted-foreground">Not set</span>}
                {k?.key_version ? (
                  <span className="ml-2 text-[0.8125rem] text-muted-foreground">key {k.key_version}</span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="form-label text-[0.75rem] font-bold text-muted-foreground">Stored at</dt>
              <dd className="min-w-0 [overflow-wrap:anywhere]">
                {k?.storage ? (
                  <>
                    {k.storage.path}
                    <span className="block font-sans text-[0.8125rem] text-muted-foreground">
                      {k.storage.format === "age" ? "age encrypted file" : k.storage.format}, on the service host
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">Not reported</span>
                )}
              </dd>
            </div>
          </dl>
          {lockProblem ? (
            <Problem className="mt-4" error={lockProblem} title="Not locked" onRetry={lock} busy={locking} />
          ) : null}
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-ink pt-4" data-print="hide">
            {!admin ? (
              <p className="text-[0.8125rem] text-muted-foreground">
                Admins unlock, lock, replace and move the key; your role reads this page.
              </p>
            ) : state === "locked" ? (
              <Button onClick={() => setUnlocking(true)}>
                <LockOpen aria-hidden="true" />
                Unlock
              </Button>
            ) : state === "unlocked" ? (
              <Button variant="secondary" onClick={lock} disabled={locking}>
                <Lock aria-hidden="true" />
                {locking ? "Locking" : "Lock now"}
              </Button>
            ) : state === "unlocked_by_env" ? (
              <p className="text-[0.8125rem] text-muted-foreground">
                Lock now is not offered: the service decrypts the key at start from its own configuration.
              </p>
            ) : null}
            {admin && state && state !== "no_key" ? (
              <>
                <Button
                  variant="secondary"
                  aria-expanded={panel === "replace"}
                  onClick={() => setPanel(panel === "replace" ? null : "replace")}
                >
                  <RefreshCw aria-hidden="true" />
                  Replace key
                </Button>
                <Button
                  variant="secondary"
                  aria-expanded={panel === "move"}
                  onClick={() => setPanel(panel === "move" ? null : "move")}
                >
                  <ArrowRightLeft aria-hidden="true" />
                  Move treasury
                </Button>
              </>
            ) : null}
          </div>
        </Card>

        <div className="grid content-start gap-5">
          <Card aria-labelledby="protected-title">
            <CardHeader
              id="protected-title"
              title="How it is protected"
              actions={<ShieldCheck className="size-4 text-muted-foreground" aria-hidden="true" />}
            />
            <ol className="mt-3 grid gap-2.5 border-t border-rule pt-3 text-[0.9375rem] [counter-reset:step]">
              {[
                `The key is a BIP-39 recovery phrase of ${PHRASE_WORDS} English words, made in your browser from its own randomness.`,
                `The phrase is encrypted in your browser with your passphrase (${PASSPHRASE_MIN} characters or more) in the age format, scrypt work factor 2^${SCRYPT_WORK_FACTOR}. Only the encrypted file reaches the service.`,
                `The encrypted file is stored at the path shown, readable by the service's user alone.`,
                "It is decrypted into the server's memory only while unlocked, for the hours an admin chose, then dropped.",
              ].map((line, i) => (
                <li key={i} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2">
                  <span className="form-label pt-[3px] text-[0.75rem] font-bold text-muted-foreground">{i + 1}.</span>
                  <span>{line}</span>
                </li>
              ))}
            </ol>
          </Card>
          <Card aria-labelledby="spend-title" data-testid="who-can-spend">
            <CardHeader
              id="spend-title"
              title="Who can spend it"
              actions={<KeyRound className="size-4 text-muted-foreground" aria-hidden="true" />}
            />
            <div className="mt-3 grid gap-2.5 border-t border-rule pt-3 text-[0.9375rem]">
              {WHO_CAN_SPEND.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </Card>
        </div>
      </div>

      {panel === "replace" && admin ? (
        <ReplacePanel
          onClose={() => setPanel(null)}
          onReplaced={(next) => {
            apply(next);
            // Every contractor's key changed: the next thing to do is on Payslip access.
            router.push("/console/access");
          }}
        />
      ) : null}
      {panel === "move" && admin ? <MovePanel treasury={k} onClose={() => setPanel(null)} /> : null}

      <UnlockDialog open={unlocking} onOpenChange={setUnlocking} onUnlocked={apply} />
    </>
  );
}

/**
 * Replace key: the warning first (every contractor's viewing key changes), then the same
 * create or import flow, then the service sweeps the old treasury into the new one.
 */
function ReplacePanel({ onClose, onReplaced }: { onClose: () => void; onReplaced: (key: TreasuryKey) => void }) {
  const [understood, setUnderstood] = useState(false);
  const [locked, setLocked] = useState<ApiError | null>(null);
  const coin = useCoinUnit();
  return (
    <section aria-labelledby="replace-title" className="mt-8" data-testid="replace-panel">
      <FormBox title="Replace the treasury key" titleId="replace-title" label="Before you start" className="mb-5">
        <p className="text-[0.9375rem] font-bold">
          Every contractor gets a new viewing key; you will re-share payslip access with each of them.
        </p>
        <p className="mt-2 text-[0.9375rem] text-muted-foreground">
          Their accounts are derived from the treasury key, so a new key means new accounts and new addresses. Past
          payslips stay readable with the old viewing keys. Everything the old treasury holds ({coin}, confirmed and
          pending) is swept into the new one once the new key is saved, which needs the current key unlocked.
        </p>
        <div className="mt-4 border-t border-ink pt-4">
          <TypedOption type="checkbox" checked={understood} onChange={setUnderstood}>
            I understand, and I will share payslip access again with every contractor
          </TypedOption>
        </div>
        {locked ? (
          <LockedPrompt
            className="mt-4"
            what="so the old treasury cannot be swept"
            error={locked}
            onUnlocked={() => setLocked(null)}
          />
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </FormBox>
      {understood ? (
        <TreasuryKeyForm
          intent="replace"
          onSeal={async (ciphertext, passphrase) => {
            try {
              return await api.replaceTreasuryKey({ ciphertext, passphrase, sweep_to: "new" });
            } catch (err) {
              if (isTreasuryLocked(err)) setLocked(err);
              throw err;
            }
          }}
          doneLabel="Share payslip access again"
          onDone={onReplaced}
        />
      ) : null}
    </section>
  );
}

/** Move treasury: everything to a shielded address outside Payslip, confirmed twice. */
function MovePanel({ treasury, onClose }: { treasury: TreasuryKey | undefined; onClose: () => void }) {
  const uid = useId();
  const { network } = useHealth();
  const coin = useCoinUnit();
  const [address, setAddress] = useState("");
  const [checked, setChecked] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [moved, setMoved] = useState<{
    txid: string | null;
    amount_zat: number | null;
    explorer_url?: string | null;
  } | null>(null);
  const target = normaliseUnifiedAddress(address);

  const first = (event: React.FormEvent) => {
    event.preventDefault();
    const why = checkUnifiedAddress(address, network)?.replace("the contractor's", "the destination");
    if (why) {
      setProblem(why);
      document.getElementById(`${uid}-to`)?.focus();
      return;
    }
    if (treasury?.address && target === treasury.address) {
      setProblem("That is the treasury's own address. Enter the address the funds should go to.");
      return;
    }
    setProblem(null);
    setWord("");
    setConfirming(true);
  };

  const move = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.moveTreasury(target);
      setMoved(r);
      setConfirming(false);
      toast.success("Treasury moved", {
        description: r.txid ? `Transaction ${truncateMiddle(r.txid, 10, 8)}` : undefined,
      });
    } catch (err) {
      setError(toDisplayError(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmed = word.trim().toUpperCase() === "MOVE";
  return (
    <section aria-labelledby="move-title" className="mt-8" data-testid="move-panel">
      <FormBox
        as="form"
        onSubmit={first}
        title="Move the treasury"
        titleId="move-title"
        label="Everything, in one shielded payment"
      >
        {moved ? (
          <div className="text-[0.9375rem]">
            <p className="font-bold">Sent.</p>
            <p className="mt-1 text-muted-foreground">
              {moved.txid ? (
                <>
                  Transaction <code className="font-type">{truncateMiddle(moved.txid, 12, 8)}</code>
                  {moved.explorer_url ? (
                    <>
                      {" "}
                      (
                      <a href={moved.explorer_url} target="_blank" rel="noreferrer" className="underline">
                        explorer
                      </a>
                      )
                    </>
                  ) : null}
                  . The treasury shows the new balance once it is mined.
                </>
              ) : (
                "The service accepted the move; the treasury shows the new balance once it is mined."
              )}
            </p>
            <div className="mt-4 border-t border-ink pt-4">
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-[0.9375rem] text-muted-foreground">
              Sends everything the treasury holds, less the network fee, to a shielded Zcash address you control outside
              Payslip. Runs waiting for funds will then be short. The key must be unlocked.
            </p>
            <div className="mt-4">
              <Field
                id={`${uid}-to`}
                label="Destination address"
                help={`A unified address on ${network ?? "this network"} (starts with ${network === "testnet" ? "utest1" : "u1"}).`}
                error={problem}
              >
                <Input
                  id={`${uid}-to`}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={!!problem}
                  aria-describedby={describedBy(`${uid}-to`, problem, true)}
                  className="font-type text-[0.9375rem]"
                />
              </Field>
            </div>
            <div className="mt-4 border-t border-ink pt-4">
              <TypedOption type="checkbox" checked={checked} onChange={setChecked}>
                I checked the address against the wallet it belongs to
              </TypedOption>
            </div>
            {error && isTreasuryLocked(error) ? (
              <LockedPrompt
                className="mt-4"
                what="so nothing can be moved"
                error={error}
                onUnlocked={() => setError(null)}
              />
            ) : error ? (
              <Problem className="mt-4" error={error} title="Not moved" />
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="submit" variant="destructive" disabled={!checked || !address.trim()}>
                Move everything
              </Button>
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </FormBox>

      <Dialog open={confirming} onOpenChange={(o) => !busy && setConfirming(o)}>
        <DialogContent className="gap-5 p-6 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Move everything out of the treasury?</DialogTitle>
            <DialogDescription>
              A shielded payment cannot be reversed. Everything goes to this address:
            </DialogDescription>
          </DialogHeader>
          <Sensitive
            block
            className="border border-bar-line bg-bar p-2 font-type text-[0.8125rem] leading-relaxed break-all"
          >
            {target}
          </Sensitive>
          <Field id={`${uid}-word`} label="Type MOVE to confirm">
            <Input
              id={`${uid}-word`}
              value={word}
              onChange={(e) => setWord(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className={cn("font-type")}
            />
          </Field>
          {error && !isTreasuryLocked(error) ? <Problem error={error} title="Not moved" /> : null}
          <DialogFooter className="-mx-6 -mb-6 bg-transparent px-6 pb-6">
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={move} disabled={busy || !confirmed}>
              {busy ? "Sending" : `Move all ${coin}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
