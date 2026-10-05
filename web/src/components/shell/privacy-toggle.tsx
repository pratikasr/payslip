"use client";

import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

const KEY = "payslip.private";

/**
 * Mercury's privacy mode: blurs every amount on screen (html[data-private] .money) for screen
 * sharing. Kept for the tab only.
 */
export function PrivacyToggle() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    try {
      setOn(sessionStorage.getItem(KEY) === "1");
    } catch {
      /* storage blocked: start visible */
    }
  }, []);
  useEffect(() => {
    document.documentElement.toggleAttribute("data-private", on);
    try {
      if (on) sessionStorage.setItem(KEY, "1");
      else sessionStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }, [on]);
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-pressed={on}
      aria-label={on ? "Show amounts" : "Hide amounts"}
      title={on ? "Show amounts" : "Hide amounts while sharing your screen"}
      onClick={() => setOn((v) => !v)}
    >
      {on ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
    </Button>
  );
}
