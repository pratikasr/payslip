"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, toDisplayError, type AccountantStatementRequest, type ApiError, type Run } from "@/lib/api";
import { latestPeriodFirst } from "@/lib/payroll";
import {
  countNew,
  isValidPeriod,
  labelResult,
  latestRunIn,
  lookbackPeriod,
  mergeKeys,
  runPeriod,
  scanBirthday,
  type BookKey,
  type BooksPeriod,
  type BooksResult,
} from "@/components/books/books-data";
import { forgetKeysOnService } from "@/components/books/forget-keys";

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
  /** The reconciliation with names from the key file joined in by fingerprint. */
  result: BooksResult | null;
  error: ApiError | null;
  /** The `birthday_height` the scan was asked to start from, when one was sent. */
  birthday: number | null;
}

interface BooksContextValue {
  /** False until the tab's saved keys have been read; nothing renders before then. */
  ready: boolean;
  keys: BookKey[];
  period: BooksPeriod | null;
  latestRun: LatestRun | null;
  scan: ScanState;
  /** Adds keys and says how many were new. */
  addKeys: (keys: BookKey[]) => { added: number; already: number };
  removeKey: (ufvk: string) => void;
  forget: () => void;
  /** Asks the service to delete its read-only scan of these keys, then forgets them here. */
  forgetOnService: () => Promise<{ forgotten: boolean }>;
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

const IDLE: ScanState = { status: "idle", phase: null, startedAt: null, result: null, error: null, birthday: null };

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    });
  });

/** The statement request for a key set: every key, the period, and where the scan can start. */
export function accountantRequest(keys: BookKey[], period: BooksPeriod): AccountantStatementRequest {
  const birthday = scanBirthday(keys);
  return {
    ufvks: keys.map((k) => k.ufvk),
    from: period.from,
    to: period.to,
    ...(birthday ? { birthday_height: birthday } : {}),
  };
}

/**
 * Runs a statement call, retrying once on its own when the service lost its lightwalletd
 * connection (it drops idle connections; the second try reconnects).
 */
export async function withLwdRetry<T>(call: () => Promise<T>, signal?: AbortSignal, onRetry?: () => void): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if ((err as ApiError)?.code !== LWD_UNREACHABLE || signal?.aborted) throw err;
    onRetry?.();
    await wait(1500, signal);
    return call();
  }
}

async function reconcile(
  keys: BookKey[],
  period: BooksPeriod,
  signal: AbortSignal,
  onRetry: () => void,
): Promise<BooksResult> {
  const body = accountantRequest(keys, period);
  return (await withLwdRetry(() => api.accountantStatement(body, signal), signal, onRetry)) as unknown as BooksResult;
}

/** The company's latest paid run by pay period, when the service can list runs (full mode). */
async function latestFromRuns(signal: AbortSignal): Promise<LatestRun | null> {
  let runs: Run[];
  try {
    // A statements-only deployment has no runs to list; do not ask.
    if ((await api.health(signal)).mode === "statements") return null;
    runs = await api.runs(signal);
  } catch (err) {
    if (signal.aborted) throw err;
    return null;
  }
  const run =
    latestPeriodFirst(runs.filter((r) => r.status === "paid"))[0] ??
    latestPeriodFirst(runs.filter((r) => r.funding))[0];
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
  const [scan, setScan] = useState<ScanState & { forKeys: BookKey[] }>({ ...IDLE, forKeys: [] });
  const [nonce, setNonce] = useState(0);
  // A result fetched while finding the default period, reused when the period it implies matches.
  const prefetched = useRef<{ key: string; result: BooksResult } | null>(null);
  // The current keys for callbacks and the scan effect, which must not re-run on a label change.
  const keysRef = useRef<BookKey[]>([]);
  useEffect(() => {
    keysRef.current = keys;
  }, [keys]);

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

  // A scan depends on the keys and their birthdays, not on labels.
  const keySig = keys.map((k) => `${k.ufvk}:${k.birthday ?? ""}`).join(",");

  useEffect(() => {
    if (!ready) return;
    const current = keysRef.current;
    if (current.length === 0) {
      setScan({ ...IDLE, forKeys: [] });
      return;
    }
    const ctrl = new AbortController();
    const startedAt = Date.now();
    const birthday = scanBirthday(current);
    const onRetry = () => setScan((s) => ({ ...s, phase: "retrying" }));
    const done = (result: BooksResult) =>
      setScan({ status: "ready", phase: null, startedAt, result, error: null, birthday, forKeys: current });

    (async () => {
      try {
        if (!period) {
          setScan({ ...IDLE, status: "loading", phase: "finding-period", startedAt, birthday, forKeys: current });
          let latest = await latestFromRuns(ctrl.signal);
          if (!latest) {
            // No run list (a statements-only deployment): find the latest run in a year of payments.
            const wide = lookbackPeriod();
            setScan((s) => ({ ...s, phase: "scanning" }));
            const result = await reconcile(current, wide, ctrl.signal, onRetry);
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
          done(result);
          return;
        }
        // Keep the clock running from the period lookup, so the elapsed time stays honest.
        setScan((s) => ({
          ...IDLE,
          status: "loading",
          phase: "scanning",
          startedAt: s.status === "loading" && s.startedAt ? s.startedAt : startedAt,
          birthday,
          forKeys: current,
        }));
        done(await reconcile(current, period, ctrl.signal, onRetry));
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setScan({
          status: "error",
          phase: null,
          startedAt,
          result: null,
          error: toDisplayError(err),
          birthday,
          forKeys: current,
        });
      }
    })();
    return () => ctrl.abort();
    // keySig stands for the keys (read through keysRef); nonce forces a rescan.
  }, [ready, keySig, period, nonce]);

  const addKeys = useCallback((added: BookKey[]) => {
    const fresh = countNew(keysRef.current, added);
    setKeys((k) => mergeKeys(k, added));
    return { added: fresh, already: added.length - fresh };
  }, []);
  const removeKey = useCallback((ufvk: string) => setKeys((k) => k.filter((x) => x.ufvk !== ufvk)), []);
  const forget = useCallback(() => {
    setKeys([]);
    setPeriodState(null);
    setLatestRun(null);
    prefetched.current = null;
  }, []);
  const forgetOnService = useCallback(async () => {
    const ufvks = keysRef.current.map((k) => k.ufvk);
    // Forgotten in this tab whatever the service answers.
    try {
      return await forgetKeysOnService(ufvks);
    } finally {
      forget();
    }
  }, [forget]);
  const setPeriod = useCallback((p: BooksPeriod) => setPeriodState({ from: p.from, to: p.to }), []);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  // Names from the key file, joined to the service's accounts by fingerprint. A result is labelled
  // with the keys it was scanned with; when only labels changed since (a key file imported over
  // pasted keys), with the current ones.
  const labelKeys = useMemo(
    () => (keys.map((k) => k.ufvk).join(",") === scan.forKeys.map((k) => k.ufvk).join(",") ? keys : scan.forKeys),
    [keys, scan.forKeys],
  );
  const shown = useMemo<ScanState>(() => {
    const { forKeys: _unused, ...rest } = scan;
    void _unused;
    return { ...rest, result: rest.result ? labelResult(rest.result, labelKeys) : null };
  }, [scan, labelKeys]);

  const value = useMemo(
    () => ({
      ready,
      keys,
      period,
      latestRun,
      scan: shown,
      addKeys,
      removeKey,
      forget,
      forgetOnService,
      setPeriod,
      refresh,
    }),
    [ready, keys, period, latestRun, shown, addKeys, removeKey, forget, forgetOnService, setPeriod, refresh],
  );
  return <BooksContext.Provider value={value}>{children}</BooksContext.Provider>;
}

export function useBooks(): BooksContextValue {
  const ctx = useContext(BooksContext);
  if (!ctx) throw new Error("useBooks must be used inside BooksProvider");
  return ctx;
}
