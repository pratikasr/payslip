"use client";

import { useId, useState } from "react";
import { Check, KeyRound } from "lucide-react";
import { CopyButton } from "@/components/app/copy-button";
import { Field, describedBy } from "@/components/app/field";
import { useCoinUnit } from "@/components/app/health-provider";
import { Sensitive } from "@/components/ds/sensitive";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toDisplayError, type ApiError, type TreasuryKey } from "@/lib/api";
import { formatDateTime, formatHeight } from "@/lib/format";
import {
  checkPassphrase,
  checkPhrase,
  checkPositions,
  checkWordsMatch,
  encryptPhrase,
  generatePhrase,
  PASSPHRASE_MIN,
  PHRASE_WORDS,
  phraseWords,
} from "@/lib/treasury-key";
import { cn } from "cn";
import { FormBox, TypedOption } from "@/components/portal/paper-parts";
import { Problem } from "@/components/runs/problem";

/*
  The treasury key, made on paper (docs/DESIGN.md section 17): choose Create or Import, the 24
  words typed on a numbered form to write down, three of them asked back, a passphrase typed
  twice, then the browser seals the phrase (lib/treasury-key.ts) and sends only the ciphertext.
  Used by the onboarding sheet (a company's first key) and by Replace key on the key page.
*/

type Step = "choose" | "words" | "check" | "import" | "passphrase" | "done";

/** The sentence the owner asked for, word for word, over the passphrase field. */
export const PASSPHRASE_SENTENCE =
  "This passphrase encrypts your key. Payslip never stores it. Without it, nobody can spend your treasury, including us.";

export function TreasuryKeyForm({
  intent,
  onSeal,
  onDone,
  doneLabel = "Open the console",
}: {
  /** "create": a company's first key. "replace": a new key that takes over from the current one. */
  intent: "create" | "replace";
  /** Sends the ciphertext and the passphrase to the service; answers the key as it is now. */
  onSeal: (ciphertext: string, passphrase: string) => Promise<TreasuryKey>;
  onDone: (key: TreasuryKey) => void;
  doneLabel?: string;
}) {
  const uid = useId();
  const coin = useCoinUnit();
  const [step, setStep] = useState<Step>("choose");
  const [source, setSource] = useState<"create" | "import">("create");
  const [phrase, setPhrase] = useState("");
  const [written, setWritten] = useState(false);
  const [positions, setPositions] = useState<number[]>([]);
  const [typed, setTyped] = useState<string[]>(["", "", ""]);
  const [checkProblem, setCheckProblem] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [pasteProblem, setPasteProblem] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [again, setAgain] = useState("");
  const [passProblem, setPassProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<"generating" | "checking" | "encrypting" | "saving" | null>(null);
  const [problem, setProblem] = useState<ApiError | null>(null);
  const [result, setResult] = useState<TreasuryKey | null>(null);
  const newKey = intent === "replace" ? "new key" : "key";

  const choose = async () => {
    if (source === "import") {
      setStep("import");
      return;
    }
    setBusy("generating");
    try {
      // A fresh phrase each time the words are generated; one left behind is never reused.
      setPhrase(await generatePhrase());
      setWritten(false);
      setPositions(checkPositions());
      setTyped(["", "", ""]);
      setCheckProblem(null);
      setStep("words");
    } catch (err) {
      setProblem(toDisplayError(err));
    } finally {
      setBusy(null);
    }
  };

  const verify = (event: React.FormEvent) => {
    event.preventDefault();
    if (!checkWordsMatch(phrase, positions, typed)) {
      const words = phraseWords(phrase);
      const wrong = positions.find((p, i) => words[p - 1] !== typed[i].trim().toLowerCase());
      setCheckProblem(`Word ${wrong} does not match what was shown. Check your copy, then type it again.`);
      document.getElementById(`${uid}-word-${wrong}`)?.focus();
      return;
    }
    setCheckProblem(null);
    setStep("passphrase");
  };

  const importPhrase = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy("checking");
    try {
      const why = await checkPhrase(pasted);
      setPasteProblem(why);
      if (why) {
        document.getElementById(`${uid}-paste`)?.focus();
        return;
      }
      setPhrase(phraseWords(pasted).join(" "));
      setStep("passphrase");
    } catch (err) {
      setProblem(toDisplayError(err));
    } finally {
      setBusy(null);
    }
  };

  const seal = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const why = checkPassphrase(passphrase, again);
    setPassProblem(why);
    if (why) {
      document.getElementById(why.startsWith("Use") ? `${uid}-pass` : `${uid}-again`)?.focus();
      return;
    }
    setProblem(null);
    setBusy("encrypting");
    try {
      const ciphertext = await encryptPhrase(phrase, passphrase);
      setBusy("saving");
      const key = await onSeal(ciphertext, passphrase);
      setResult(key);
      // The words and the passphrase have done their work: nothing keeps them.
      setPhrase("");
      setPasted("");
      setPassphrase("");
      setAgain("");
      setTyped(["", "", ""]);
      setStep("done");
    } catch (err) {
      setProblem(toDisplayError(err));
    } finally {
      setBusy(null);
    }
  };

  if (step === "done" && result) {
    return (
      <FormBox title={intent === "replace" ? "New treasury key" : "Treasury key"} label="Saved" titleAs="h2">
        <p className="flex items-start gap-2.5 text-[0.9375rem]">
          <span className="grid size-6 shrink-0 place-items-center border-2 border-ink bg-ink text-paper">
            <Check className="size-4" strokeWidth={3} aria-hidden="true" />
          </span>
          <span>
            The {newKey} is sealed with your passphrase and saved on the service. It is{" "}
            {result.state === "locked" ? "locked" : "unlocked for payroll"}
            {result.state === "unlocked" && result.unlocked_until
              ? ` until ${formatDateTime(result.unlocked_until)}`
              : ""}
            .
          </span>
        </p>
        <dl className="mt-4 grid gap-3 border-t border-ink pt-4 font-type text-[0.9375rem]">
          <div>
            <dt className="form-label text-[0.75rem] font-bold text-muted-foreground">Treasury address</dt>
            <dd className="mt-1 flex items-start gap-1">
              <Sensitive
                block
                className="min-w-0 flex-1 border border-bar-line bg-bar p-2 text-[0.8125rem] leading-relaxed break-all"
              >
                <span data-testid="treasury-address">{result.address ?? "Not known yet"}</span>
              </Sensitive>
              {result.address ? <CopyButton value={result.address} label="treasury address" size="icon-sm" /> : null}
            </dd>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <dt className="form-label text-[0.75rem] font-bold text-muted-foreground">Birthday height</dt>
              <dd className="num mt-0.5">{formatHeight(result.birthday_height)}</dd>
            </div>
            <div>
              <dt className="form-label text-[0.75rem] font-bold text-muted-foreground">Encrypted file</dt>
              <dd className="mt-0.5 [overflow-wrap:anywhere]">{result.storage?.path ?? "On the service"}</dd>
            </div>
          </div>
        </dl>
        <p className="mt-4 text-[0.8125rem] text-muted-foreground">
          Send {coin} to the address to fund payroll. Keep the written words somewhere safe: they recover the treasury
          in any Zcash wallet if this server is lost.
        </p>
        <div className="mt-5 border-t border-ink pt-4">
          <Button onClick={() => onDone(result)}>{doneLabel}</Button>
        </div>
      </FormBox>
    );
  }

  if (step === "choose") {
    return (
      <FormBox title={intent === "replace" ? "New treasury key" : "Your treasury key"} label="Step 1 of 3" titleAs="h2">
        <p className="text-[0.9375rem] text-muted-foreground">
          The treasury key is a recovery phrase of {PHRASE_WORDS} words. It is made in this browser and encrypted here
          with a passphrase only you know; the service receives the encrypted file and never the words.
        </p>
        <div role="radiogroup" aria-label="Where the key comes from" className="mt-5 grid gap-3">
          <TypedOption
            name={`${uid}-source`}
            checked={source === "create"}
            onChange={() => setSource("create")}
            hint="Recommended. New words from this browser's randomness, shown once to write down."
          >
            Create a new key
          </TypedOption>
          <TypedOption
            name={`${uid}-source`}
            checked={source === "import"}
            onChange={() => setSource("import")}
            hint={`Paste the ${PHRASE_WORDS} words of a wallet you already hold, for example one made with the service's command line.`}
          >
            Import a recovery phrase
          </TypedOption>
        </div>
        {problem ? <Problem className="mt-4" error={problem} title="Could not start" /> : null}
        <div className="mt-5 border-t border-ink pt-4">
          <Button onClick={choose} disabled={busy !== null}>
            {busy === "generating" ? "Generating" : "Continue"}
          </Button>
        </div>
      </FormBox>
    );
  }

  if (step === "words") {
    const words = phraseWords(phrase);
    return (
      <FormBox title="Recovery phrase" label="Step 2 of 3: write these down" titleAs="h2">
        <p className="text-[0.9375rem]">
          Write these {PHRASE_WORDS} words down, in this order, on paper. Keep the paper somewhere safe and away from
          this computer. Anyone with the words can spend your treasury; without them, a lost server cannot be recovered,
          by you or by Payslip.
        </p>
        {/* Typed on a numbered form, cells ruled in hairline. Privacy mode blurs them like any key. */}
        <Sensitive block className="mt-4">
          <ol
            className="grid grid-cols-2 border-t border-l border-ink font-type sm:grid-cols-3 lg:grid-cols-4"
            aria-label="The 24 words of the recovery phrase, in order"
            data-testid="recovery-words"
          >
            {words.map((w, i) => (
              <li key={i} className="flex items-baseline gap-2 border-r border-b border-ink px-2.5 py-2">
                <span className="form-label w-[2ch] shrink-0 text-right text-[0.75rem] text-muted-foreground">
                  {i + 1}
                </span>
                <span className="text-[1rem] font-bold" data-word={i + 1}>
                  {w}
                </span>
              </li>
            ))}
          </ol>
        </Sensitive>
        <p className="mt-3 text-[0.8125rem] text-muted-foreground">
          There is no copy button on purpose: the clipboard and screenshots are where phrases leak. Pen and paper.
        </p>
        <div className="mt-4 border-t border-ink pt-4">
          <TypedOption type="checkbox" checked={written} onChange={setWritten}>
            I have written them down
          </TypedOption>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => setStep("check")} disabled={!written}>
            Continue
          </Button>
          <Button variant="secondary" onClick={() => setStep("choose")}>
            Back
          </Button>
        </div>
      </FormBox>
    );
  }

  if (step === "check") {
    return (
      <FormBox as="form" onSubmit={verify} title="Check your copy" label="Step 2 of 3: three words" titleAs="h2">
        <p className="text-[0.9375rem] text-muted-foreground">
          Type these three words from the paper, so a mistake is caught now and not when the treasury must be recovered.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {positions.map((p, i) => (
            <Field key={p} id={`${uid}-word-${p}`} label={`Word ${p}`}>
              <Input
                id={`${uid}-word-${p}`}
                value={typed[i]}
                onChange={(e) => setTyped((t) => t.map((v, j) => (j === i ? e.target.value : v)))}
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={!!checkProblem}
                aria-describedby={checkProblem ? `${uid}-check-problem` : undefined}
              />
            </Field>
          ))}
        </div>
        {checkProblem ? (
          <p id={`${uid}-check-problem`} role="alert" className="mt-3 text-[0.8125rem] text-danger">
            {checkProblem}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2 border-t border-ink pt-4">
          <Button type="submit">Continue</Button>
          <Button type="button" variant="secondary" onClick={() => setStep("words")}>
            Show the words again
          </Button>
        </div>
      </FormBox>
    );
  }

  if (step === "import") {
    return (
      <FormBox as="form" onSubmit={importPhrase} title="Import a recovery phrase" label="Step 2 of 3" titleAs="h2">
        <Field
          id={`${uid}-paste`}
          label="Recovery phrase"
          help={`${PHRASE_WORDS} English words separated by spaces. The list and the checksum are checked here before anything is encrypted.`}
          error={pasteProblem}
        >
          <Textarea
            id={`${uid}-paste`}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={4}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={!!pasteProblem}
            aria-describedby={describedBy(`${uid}-paste`, pasteProblem, true)}
            className={cn("min-h-24 text-[0.9375rem]")}
          />
        </Field>
        {problem ? <Problem className="mt-4" error={problem} title="Could not check the phrase" /> : null}
        <div className="mt-5 flex flex-wrap gap-2 border-t border-ink pt-4">
          <Button type="submit" disabled={busy !== null || !pasted.trim()}>
            {busy === "checking" ? "Checking" : "Continue"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setStep("choose")}>
            Back
          </Button>
        </div>
      </FormBox>
    );
  }

  // passphrase
  return (
    <FormBox as="form" onSubmit={seal} title="Passphrase" label="Step 3 of 3" titleAs="h2">
      <p className="flex items-start gap-2.5 text-[0.9375rem]">
        <KeyRound className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span>{PASSPHRASE_SENTENCE}</span>
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field
          id={`${uid}-pass`}
          label="Passphrase"
          help={`${PASSPHRASE_MIN} characters or more. A few unrelated words are easy to remember and hard to guess.`}
        >
          <Input
            id={`${uid}-pass`}
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoComplete="new-password"
            aria-invalid={!!passProblem && passProblem.startsWith("Use")}
            aria-describedby={describedBy(`${uid}-pass`, undefined, true)}
          />
        </Field>
        <Field id={`${uid}-again`} label="Passphrase again" error={passProblem}>
          <Input
            id={`${uid}-again`}
            type="password"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
            autoComplete="new-password"
            aria-invalid={!!passProblem}
            aria-describedby={describedBy(`${uid}-again`, passProblem)}
          />
        </Field>
      </div>
      {problem ? (
        <Problem className="mt-4" error={problem} title={`The ${newKey} was not saved`} onRetry={() => void seal()} />
      ) : null}
      <div className="mt-5 flex flex-wrap gap-2 border-t border-ink pt-4">
        <Button type="submit" disabled={busy !== null}>
          {busy === "encrypting" ? "Encrypting" : busy === "saving" ? "Saving" : "Encrypt and save"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={busy !== null}
          onClick={() => setStep(source === "import" ? "import" : "check")}
        >
          Back
        </Button>
      </div>
    </FormBox>
  );
}
