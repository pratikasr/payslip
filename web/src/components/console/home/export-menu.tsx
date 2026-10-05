"use client";

import Link from "next/link";
import { ChevronDown, Download, FileKey2, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { useCoinUnit, useHealth } from "@/components/app/health-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Run } from "@/lib/api";
import { saveText } from "@/lib/download";
import { todayIso } from "@/lib/format";
import { payrollCsv, payrollCsvName } from "@/lib/payroll-csv";

/**
 * Home's Export: the company's own payroll as CSV (every run and line, made in this browser from
 * the runs already on screen, nothing sent anywhere), and the auditor package of viewing keys for
 * the accountant, which lives on Payslip access.
 */
export function ExportMenu({ runs }: { runs: Run[] }) {
  const coin = useCoinUnit();
  const { network } = useHealth();
  const lines = runs.reduce((n, r) => n + r.lines.length, 0);
  const downloadCsv = () => {
    const name = payrollCsvName(network, todayIso());
    saveText(payrollCsv(runs, coin), name, "text/csv");
    toast.success(`Saved ${name}`, {
      description: `${lines} ${lines === 1 ? "line" : "lines"} from ${runs.length} ${runs.length === 1 ? "run" : "runs"}.`,
    });
  };
  return (
    // Not modal: the page stays readable around the open menu (Escape and Tab still close it).
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary">
          <Download aria-hidden="true" />
          Export
          <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72" portal={false}>
        <DropdownMenuLabel>Export</DropdownMenuLabel>
        <DropdownMenuItem disabled={lines === 0} onSelect={downloadCsv}>
          <FileSpreadsheet aria-hidden="true" />
          <span className="grid">
            <span className="text-foreground">Payroll CSV (every run and line)</span>
            <span className="text-[0.8125rem] text-muted-foreground">
              {lines === 0
                ? "Nothing to export until a run exists"
                : `${runs.length} ${runs.length === 1 ? "run" : "runs"}, ${lines} ${lines === 1 ? "line" : "lines"}, with txids and blocks`}
            </span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/console/access#auditor-package">
            <FileKey2 aria-hidden="true" />
            <span className="grid">
              <span className="text-foreground">Auditor package (viewing keys)</span>
              <span className="text-[0.8125rem] text-muted-foreground">One key file for your accountant</span>
            </span>
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
