"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { PRESENT_ATTR, PRESENT_KEY } from "@/lib/presenter";

function setPresent(on: boolean) {
  const root = document.documentElement;
  if (on) root.setAttribute(PRESENT_ATTR, "");
  else root.removeAttribute(PRESENT_ATTR);
  try {
    if (on) window.sessionStorage.setItem(PRESENT_KEY, "1");
    else window.sessionStorage.removeItem(PRESENT_KEY);
  } catch {
    // Storage can be blocked; the attribute alone still works for this page.
  }
}

/**
 * Alt+P (Option+P on a Mac) toggles presenter mode anywhere except while
 * typing. A modifier is required so a stray key press never changes the page.
 */
export function PresenterMode() {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "KeyP" || !event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      const on = !document.documentElement.hasAttribute(PRESENT_ATTR);
      setPresent(on);
      toast(on ? "Presenter mode on" : "Presenter mode off", {
        description: on ? "Larger type, less chrome. Alt+P turns it off." : "Alt+P or ?present=1 turns it back on.",
        duration: 2000,
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
