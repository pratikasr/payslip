"use client";

import { useEffect } from "react";

/**
 * Names the browser tab after what the page shows when that is only known in the browser (a
 * locked portal, an empty Books, a payslip once read). Next writes the route's metadata title
 * after hydration, so the title is re-applied whenever the <title> element changes while the
 * component is on screen, and the previous title comes back when it leaves.
 */
export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    const apply = () => {
      if (document.title !== title) document.title = title;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      document.title = previous;
    };
  }, [title]);
}

/** The same, as an element for server components (not-found pages). */
export function DocumentTitle({ title }: { title: string }) {
  useDocumentTitle(title);
  return null;
}
