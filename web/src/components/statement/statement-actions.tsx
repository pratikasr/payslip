"use client";

import { useEffect, useState } from "react";
import { FileDown, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { toDisplayError } from "@/lib/api";
import { saveBlob } from "@/lib/download";

/** Export CSV (from the service) and Print / Save as PDF (browser print dialog). */
export function StatementActions({
  fetchCsv,
  filename,
}: {
  fetchCsv: () => Promise<{ blob: Blob; filename: string | null }>;
  filename: string;
}) {
  const [busy, setBusy] = useState(false);
  usePrintOpensDetails();
  const exportCsv = async () => {
    setBusy(true);
    try {
      const res = await fetchCsv();
      saveBlob(res.blob, res.filename ?? filename);
      toast.success("CSV downloaded");
    } catch (err) {
      const e = toDisplayError(err);
      toast.error(e.message, { description: e.hint });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap gap-2" data-print="hide">
      <Button variant="outline" onClick={exportCsv} disabled={busy}>
        <FileDown aria-hidden="true" />
        {busy ? "Preparing CSV" : "Export CSV"}
      </Button>
      <Button variant="outline" onClick={() => window.print()}>
        <Printer aria-hidden="true" />
        Print / Save as PDF
      </Button>
    </div>
  );
}

/**
 * Collapsed sections (the funding list) must appear on paper. Open every
 * closed <details> before printing, whether printing starts from the button
 * or the browser menu, and close them again afterwards.
 */
function usePrintOpensDetails() {
  useEffect(() => {
    let opened: HTMLDetailsElement[] = [];
    const before = () => {
      opened = Array.from(document.querySelectorAll<HTMLDetailsElement>("main details:not([open])"));
      opened.forEach((d) => (d.open = true));
    };
    const after = () => {
      opened.forEach((d) => (d.open = false));
      opened = [];
    };
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);
}
