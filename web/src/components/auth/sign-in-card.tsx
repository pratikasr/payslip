"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert } from "lucide-react";
import { LogoMark } from "@/components/app/logo";
import { Field } from "@/components/app/field";
import { Card } from "@/components/ds/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { TYPE } from "@/components/ds/type";
import { cn } from "cn";

/** Better Auth's error codes after a Google round trip, in plain words. */
function describeError(code: string): string {
  switch (code) {
    case "access_denied":
      return "Google did not sign you in: the request was cancelled.";
    case "unable_to_create_user":
    case "signup_disabled":
      return "That Google account cannot be used here.";
    case "email_not_verified":
      return "Google has not verified that email address.";
    case "state_mismatch":
    case "invalid_code":
    case "please_restart_the_process":
      return "The sign-in did not complete. Start again.";
    case "oauth_code_verification_failed":
    case "oauth_provider_error":
      return "Google refused the sign-in. Check the OAuth client's redirect URI, then try again.";
    default:
      return `Sign-in failed (${code}). Try again.`;
  }
}

/**
 * The sign-in card: one calm card, the Google button, and, for browser tests only, an email and
 * password form (PAYSLIP_AUTH_TEST_LOGIN=1). A Workspace domain lock is said out loud so the
 * person picks the right Google account.
 */
export function SignInCard({
  next,
  google,
  testLogin,
  domain,
  error,
}: {
  next: string;
  google: boolean;
  testLogin: boolean;
  domain: string | undefined;
  error: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"google" | "email" | null>(null);
  const [problem, setProblem] = useState<string | null>(error ? describeError(error) : null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const withGoogle = async () => {
    setBusy("google");
    setProblem(null);
    try {
      await authClient.signIn.social({
        provider: "google",
        callbackURL: next,
        errorCallbackURL: `/sign-in?next=${encodeURIComponent(next)}`,
      });
    } catch {
      setProblem("Could not start the Google sign-in. Reload the page and try again.");
      setBusy(null);
    }
  };

  const withEmail = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy("email");
    setProblem(null);
    const { error: err } = await authClient.signIn.email({ email: email.trim(), password });
    if (err) {
      setProblem(err.message || "That email and password were not accepted.");
      setBusy(null);
      return;
    }
    router.push(next);
    router.refresh();
  };

  return (
    <Card className="px-6 py-7 sm:px-8">
      <LogoMark className="size-[30px]" />
      <h1 className={cn(TYPE.title, "mt-5")}>Sign in to Payslip</h1>
      <p className="mt-2 text-[0.9375rem] text-muted-foreground">
        Private payroll on Zcash. Sign in with the Google account your organisation invited
        {domain && domain !== "*" ? (
          <>
            {" "}
            (an <span className="text-foreground">@{domain}</span> account)
          </>
        ) : null}
        .
      </p>
      {problem ? (
        <div role="alert" className="mt-5 flex items-start gap-2.5 rounded-xl bg-danger-bg px-4 py-3 text-[0.8125rem]">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
          <span>{problem}</span>
        </div>
      ) : null}
      <div className="mt-6 grid gap-3 border-t border-hairline pt-6">
        {google ? (
          <Button type="button" size="lg" onClick={withGoogle} disabled={busy !== null} className="w-full">
            <GoogleMark />
            {busy === "google" ? "Opening Google" : "Continue with Google"}
          </Button>
        ) : (
          <p className="text-[0.8125rem] text-muted-foreground">
            Google sign-in is not configured on this deployment yet: whoever runs it sets GOOGLE_CLIENT_ID and
            GOOGLE_CLIENT_SECRET (see the Sign-in section of the README).
          </p>
        )}
        {testLogin ? (
          <form onSubmit={withEmail} className="grid gap-3 border-t border-hairline pt-4" aria-label="Test sign-in">
            <p className="text-[0.8125rem] text-muted-foreground">Test sign-in (browser tests only)</p>
            <Field id="signin-email" label="Email">
              <Input
                id="signin-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>
            <Field id="signin-password" label="Password">
              <Input
                id="signin-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            <Button type="submit" variant="secondary" disabled={busy !== null}>
              {busy === "email" ? "Signing in" : "Sign in with email"}
            </Button>
          </form>
        ) : null}
      </div>
    </Card>
  );
}

/** Google's "G", drawn in one colour so it sits on the gold button like the other icons. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
      <path
        fill="currentColor"
        d="M21.6 12.23c0-.68-.06-1.33-.17-1.96H12v3.7h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.24c1.9-1.75 2.98-4.32 2.98-7.26Z"
      />
      <path
        fill="currentColor"
        opacity=".8"
        d="M12 22c2.7 0 4.96-.9 6.62-2.42l-3.24-2.5c-.9.6-2.04.95-3.38.95-2.6 0-4.8-1.75-5.58-4.1H3.07v2.58A10 10 0 0 0 12 22Z"
      />
      <path
        fill="currentColor"
        opacity=".6"
        d="M6.42 13.93A6 6 0 0 1 6.1 12c0-.67.12-1.32.32-1.93V7.49H3.07a10 10 0 0 0 0 9.02l3.35-2.58Z"
      />
      <path
        fill="currentColor"
        opacity=".9"
        d="M12 5.98c1.47 0 2.78.5 3.82 1.5l2.86-2.87A9.98 9.98 0 0 0 3.07 7.49l3.35 2.58C7.2 7.73 9.4 5.98 12 5.98Z"
      />
    </svg>
  );
}
