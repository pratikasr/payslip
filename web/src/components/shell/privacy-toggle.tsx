"use client";

import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { PRIVATE_ATTR, PRIVATE_KEY } from "@/lib/privacy";

/**
 * Mercury's privacy mode: blurs every amount on screen (html[data-private] .money) for screen
 * sharing. Kept for the tab only. The console layout applies a stored choice before first paint
 * (src/lib/privacy.ts); this button reads it back and changes it.
 */
export function PrivacyToggle() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    // Layouts without the boot script (portal, books) apply the stored choice here, after paint.
    let stored = document.documentElement.hasAttribute(PRIVATE_ATTR);
    try {
      stored = stored || sessionStorage.getItem(PRIVATE_KEY) === "1";
    } catch {
      /* storage blocked: keep what the page shows */
    }
    if (stored) document.documentElement.setAttribute(PRIVATE_ATTR, "");
    setOn(stored);
  }, []);
  const toggle = () => {
    const next = !on;
    setOn(next);
    document.documentElement.toggleAttribute(PRIVATE_ATTR, next);
    try {
      if (next) sessionStorage.setItem(PRIVATE_KEY, "1");
      else sessionStorage.removeItem(PRIVATE_KEY);
    } catch {
      /* storage blocked: the choice holds for this page only */
    }
  };
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-pressed={on}
      aria-label={on ? "Show amounts" : "Hide amounts"}
      title={on ? "Show amounts" : "Hide amounts while sharing your screen"}
      onClick={toggle}
    >
      {on ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
    </Button>
  );
}
