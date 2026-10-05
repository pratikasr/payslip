"use client";

import Link from "next/link";
import { useEffect, useState, type ComponentProps } from "react";
import { api } from "@/lib/api";

/*
  "Try the live demo" opens the company console, which needs a wallet. A statements-only
  deployment (health.mode "statements", the one judges are pointed at) has none, so there the
  same calls to action open Books, where the judge kit loads with one click.
*/

let mode: Promise<"full" | "statements" | null> | null = null;

/** The deployment's mode, asked once per page load; null when the service cannot be reached. */
function deploymentMode(): Promise<"full" | "statements" | null> {
  mode ??= api
    .health()
    .then((h) => (h.mode === "statements" ? "statements" : "full"))
    .catch(() => null);
  return mode;
}

export function useStatementsOnly(): boolean {
  const [statements, setStatements] = useState(false);
  useEffect(() => {
    let live = true;
    void deploymentMode().then((m) => live && setStatements(m === "statements"));
    return () => {
      live = false;
    };
  }, []);
  return statements;
}

/**
 * A call to action for the demo: the console on a full deployment, Books with the judge kit on a
 * statements-only one. Renders as a plain link, so it can sit inside `Button asChild`.
 */
export function DemoLink({
  liveLabel = "Try the live demo",
  kitLabel = "Import the judge kit",
  ...props
}: Omit<ComponentProps<typeof Link>, "href" | "children"> & { liveLabel?: string; kitLabel?: string }) {
  const statements = useStatementsOnly();
  return (
    <Link {...props} href={statements ? "/books" : "/console"}>
      {statements ? kitLabel : liveLabel}
    </Link>
  );
}
