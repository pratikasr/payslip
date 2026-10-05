"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, toDisplayError, type ApiError, type Run } from "@/lib/api";
import {
  isValidPeriod,
  latestRunIn,
  lookbackPeriod,
  mergeKeys,
  runPeriod,
  type BookKey,
  type BooksPeriod,
  type BooksResult,
} from "@/components/books/books-data";

const STORAGE_KEY = "payslip.books";
const LWD_UNREACHABLE = "lightwalletd_unreachable";

export interface LatestRun {
  /** The payroll period label, "2026-09". */
  label: string;
  period: BooksPeriod;
}

export type ScanPhase = "finding-period" | "scanning" | "retrying";

export interface ScanState {
  status: "idle" | "loading" | "ready" | "error";
  phase: ScanPhase | null;
  startedAt: number | null;
  result: BooksResult | null;
  error: ApiError | null;
}

interface BooksContextValue {
  /** False until the tab's saved keys have been read; nothing renders before then. */
  ready: boolean;
  keys: BookKey[];
  period: BooksPeriod | null;
  latestRun: LatestRun | null;
  scan: ScanState;
  addKeys: (keys: BookKey[]) => void;
  removeKey: (ufvk: string) => void;
  forget: () => void;
  setPeriod: (period: BooksPeriod) => void;
  refresh: () => void;
}

const BooksContext = createContext<BooksContextValue | null>(null);

interface Saved {
  keys: BookKey[];
  period: BooksPeriod | null;
  latestRun: LatestRun | null;
}

function readSaved(): Saved | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<Saved>;
    if (!Array.isArray(data.keys)) return null;
    const keys = data.keys.filter(
      (k): k is BookKey => typeof k === "object" && k !== null && typeof (k as BookKey).ufvk === "string",
    );
    const period = data.period && isValidPeriod(data.period) ? data.period : null;
    return { keys, period, latestRun: data.latestRun ?? null };
  } catch {
    return null;
  }
}

function writeSaved(saved: Saved) {
  try {
    if (saved.keys.length === 0) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    /* storage blocked: the keys last for this page only */
  }
}

const IDLE: ScanState = { status: "idle", phase: null, startedAt: null, result: null, error: null };

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

/** Reconcile, retrying once on its own when the service lost its lightwalletd connection. */
async function reconcile(
  ufvks: string[],
  period: BooksPeriod,
  signal: AbortSignal,
  onRetry: () => void,
): Promise<BooksResult> {
  const body = { ufvks, from: period.from, to: period.to };
  try {
    return (await api.accountantStatement(body, signal)) as BooksResult;
  } catch (err) {
    if ((err as ApiError)?.code !== LWD_UNREACHABLE || signal.aborted) throw err;
    onRetry();
    await wait(1500, signal);
    return (await api.accountantStatement(body, signal)) as BooksResult;
  }
}

/** The company's latest paid run, when the service can list runs (full mode). */
async function latestFromRuns(signal: AbortSignal): Promise<LatestRun | null> {
  let runs: Run[];
  try {
    runs = await api.runs(signal);
  } catch (err) {
    if (signal.aborted) throw err;
    return null;
  }
  const newest = (list: Run[]) => [...list].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const run = newest(runs.filter((r) => r.status === "paid")) ?? newest(runs.filter((r) => r.funding)) ?? null;
  if (!run) return null;
  const paidOn = run.status === "paid" ? run.updated_at : null;
  return { label: run.period_label, period: runPeriod(run.period_start, run.period_end, paidOn) };
}

/**
 * Holds the accountant's viewing keys and period for this tab (sessionStorage) and the latest
 * reconciliation. Every Books page reads from here, so moving between them never rescans.
 */
export function BooksProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [keys, setKeys] = useState<BookKey[]>([]);
  const [period, setPeriodState] = useState<BooksPeriod | null>(null);
  const [latestRun, setLatestRun] = useState<LatestRun | null>(null);
  const [scan, setScan] = useState<ScanState>(IDLE);
  const [nonce, setNonce] = useState(0);
  // A result fetched while finding the default period, reused when the period it implies matches.
  const prefetched = useRef<{ key: string; result: BooksResult } | null>(null);

  useEffect(() => {
    const saved = readSaved();
    if (saved) {
      setKeys(saved.keys);
      setPeriodState(saved.period);
      setLatestRun(saved.latestRun);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) writeSaved({ keys, period, latestRun });
  }, [ready, keys, period, latestRun]);

  const ufvkList = useMemo(() => keys.map((k) => k.ufvk), [keys]);
  const keySig = ufvkList.join(",");

  useEffect(() => {
    if (!ready) return;
    if (ufvkList.length === 0) {
      setScan(IDLE);
      return;
    }
    const ctrl = new AbortController();
    const startedAt = Date.now();
    const onRetry = () => setScan((s) => ({ ...s, phase: "retrying" }));

    (async () => {
      try {
        if (!period) {
          setScan({ ...IDLE, status: "loading", phase: "finding-period", startedAt });
          let latest = await latestFromRuns(ctrl.signal);
          if (!latest) {
            // No run list (a statements-only deployment): find the latest run in a year of payments.
            const wide = lookbackPeriod();
            setScan((s) => ({ ...s, phase: "scanning" }));
            const result = await reconcile(ufvkList, wide, ctrl.signal, onRetry);
            const found = latestRunIn(result);
            latest = found ? { label: found.label, period: found.period } : null;
            const chosen = latest?.period ?? wide;
            prefetched.current =
              chosen.from === wide.from && chosen.to === wide.to
                ? { key: `${keySig}|${wide.from}|${wide.to}`, result }
                : null;
            if (latest) setLatestRun(latest);
            setPeriodState(chosen);
            return;
          }
          setLatestRun(latest);
          setPeriodState(latest.period);
          return;
        }
        const reqKey = `${keySig}|${period.from}|${period.to}`;
        if (prefetched.current?.key === reqKey) {
          const result = prefetched.current.result;
          prefetched.current = null;
          setScan({ status: "ready", phase: null, startedAt, result, error: null });
          return;
        }
        // Keep the clock running from the period lookup, so the elapsed time stays honest.
        setScan((s) => ({
          ...IDLE,
          status: "loading",
          phase: "scanning",
          startedAt: s.status === "loading" && s.startedAt ? s.startedAt : startedAt,
        }));
        const result = await reconcile(ufvkList, period, ctrl.signal, onRetry);
        setScan({ status: "ready", phase: null, startedAt, result, error: null });
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setScan({ status: "error", phase: null, startedAt, result: null, error: toDisplayError(err) });
      }
    })();
    return () => ctrl.abort();
    // keySig stands for ufvkList; nonce forces a rescan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, keySig, period, nonce]);

  const addKeys = useCallback((added: BookKey[]) => setKeys((k) => mergeKeys(k, added)), []);
  const removeKey = useCallback((ufvk: string) => setKeys((k) => k.filter((x) => x.ufvk !== ufvk)), []);
  const forget = useCallback(() => {
    setKeys([]);
    setPeriodState(null);
    setLatestRun(null);
    prefetched.current = null;
  }, []);
  const setPeriod = useCallback((p: BooksPeriod) => setPeriodState({ from: p.from, to: p.to }), []);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const value = useMemo(
    () => ({ ready, keys, period, latestRun, scan, addKeys, removeKey, forget, setPeriod, refresh }),
    [ready, keys, period, latestRun, scan, addKeys, removeKey, forget, setPeriod, refresh],
  );
  return <BooksContext.Provider value={value}>{children}</BooksContext.Provider>;
}

export function useBooks(): BooksContextValue {
  const ctx = useContext(BooksContext);
  if (!ctx) throw new Error("useBooks must be used inside BooksProvider");
  return ctx;
}
