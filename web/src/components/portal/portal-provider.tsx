"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { toDisplayError, type ApiError, type Statement } from "@/lib/api";
import { classifyKey } from "@/lib/keys";
import { forgetKeysOnService } from "@/components/books/forget-keys";
import {
  KEY_ERRORS,
  NO_META,
  fetchStatement,
  guessCurrency,
  keyErrorText,
  parseInvite,
  personName,
  recentRange,
  statementRequest,
  type KeyMeta,
} from "@/components/portal/portal-data";

/** The unlocked key lives in this tab only and is sent nowhere but the Payslip service. */
const KEY_STORAGE = "payslip.portal.key";
/** The name and birthday an invite link or key file carried, kept beside the key for this tab. */
const META_STORAGE = "payslip.portal.meta";
const CURRENCY_STORAGE = "payslip.portal.currency";

interface Recent {
  statement?: Statement;
  error?: ApiError;
  loading: boolean;
  /** When the current request started, for the elapsed time in the loading text. */
  startedAt?: number;
}

interface PortalState {
  /** False until the tab's stored key and any invite link have been read. */
  ready: boolean;
  ufvk: string | null;
  /** The name and birthday that came with the key, if any. */
  meta: KeyMeta;
  unlock: (ufvk: string, meta?: KeyMeta) => void;
  lock: (reason?: string | null) => void;
  /** Asks the service to delete its read-only scan of this key, then locks the tab. */
  forgetOnService: () => Promise<{ forgotten: boolean }>;
  /** Why the portal is locked, when it locked itself (a bad invite link or a refused key). */
  lockReason: string | null;
  /** The person's currency for the value at receipt (mainnet). */
  currency: string;
  setCurrency: (currency: string) => void;
  /** The last twelve months of payments to this key: home and payslips read it. */
  recent: Recent;
  range: { from: string; to: string };
  reload: () => void;
}

const PortalContext = createContext<PortalState | null>(null);

function store(kind: "session" | "local", key: string, value: string | null) {
  try {
    const s = kind === "session" ? sessionStorage : localStorage;
    if (value === null) s.removeItem(key);
    else s.setItem(key, value);
  } catch {
    /* storage blocked: the key lasts until the page reloads */
  }
}

function read(kind: "session" | "local", key: string): string | null {
  try {
    return (kind === "session" ? sessionStorage : localStorage).getItem(key);
  } catch {
    return null;
  }
}

function readMeta(): KeyMeta {
  try {
    const m = JSON.parse(read("session", META_STORAGE) ?? "null") as Partial<KeyMeta> | null;
    return {
      label: typeof m?.label === "string" && m.label ? m.label : null,
      birthday: typeof m?.birthday === "number" && m.birthday > 0 ? m.birthday : null,
    };
  } catch {
    return NO_META;
  }
}

export function PortalProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [ufvk, setUfvk] = useState<string | null>(null);
  const [meta, setMeta] = useState<KeyMeta>(NO_META);
  const [lockReason, setLockReason] = useState<string | null>(null);
  const [currency, setCurrencyState] = useState("USD");
  const [recent, setRecent] = useState<Recent>({ loading: false });
  const [attempt, setAttempt] = useState(0);
  const range = useMemo(() => recentRange(), []);

  const unlock = useCallback((key: string, extra: KeyMeta = NO_META) => {
    setRecent({ loading: false });
    setLockReason(null);
    setUfvk(key);
    setMeta(extra);
    store("session", KEY_STORAGE, key);
    store("session", META_STORAGE, extra.label || extra.birthday ? JSON.stringify(extra) : null);
  }, []);

  const lock = useCallback((reason?: string | null) => {
    setUfvk(null);
    setMeta(NO_META);
    setRecent({ loading: false });
    setLockReason(reason ?? null);
    store("session", KEY_STORAGE, null);
    store("session", META_STORAGE, null);
  }, []);

  const setCurrency = useCallback((c: string) => {
    setCurrencyState(c);
    store("local", CURRENCY_STORAGE, c);
  }, []);

  // An invite link (#key=<viewing key>, optionally &name= and &birthday=) unlocks the tab, then
  // the key leaves the address bar.
  useEffect(() => {
    const fromInvite = (): boolean => {
      if (!/^#key=/.test(window.location.hash)) return false;
      const invite = parseInvite(window.location.hash);
      // After Next's own history effects have run, or the router writes the fragment back.
      const clean = window.location.pathname + window.location.search;
      setTimeout(() => window.history.replaceState(null, "", clean), 0);
      const result = classifyKey(invite.key);
      if (result.kind === "ufvk") unlock(result.value, invite.meta);
      else lock(`This invite link does not hold a viewing key Payslip can use. ${result.reason}`);
      return true;
    };
    if (!fromInvite()) {
      const stored = read("session", KEY_STORAGE);
      if (stored && classifyKey(stored).kind === "ufvk") {
        setUfvk(stored);
        setMeta(readMeta());
      }
    }
    setCurrencyState(read("local", CURRENCY_STORAGE) ?? guessCurrency());
    setReady(true);
    const onHash = () => void fromInvite();
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [lock, unlock]);

  useEffect(() => {
    if (!ufvk) return;
    const ctrl = new AbortController();
    setRecent((r) => ({ statement: r.statement, loading: true, startedAt: Date.now() }));
    fetchStatement(statementRequest(ufvk, range, meta, currency), ctrl.signal)
      .then((statement) => {
        if (!ctrl.signal.aborted) setRecent({ statement, loading: false });
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        const e = toDisplayError(err);
        if (KEY_ERRORS.has(e.code)) lock(keyErrorText(e));
        else setRecent((r) => ({ statement: r.statement, error: e, loading: false }));
      });
    return () => ctrl.abort();
  }, [ufvk, meta, currency, range, attempt, lock]);

  const forgetOnService = useCallback(async () => {
    if (!ufvk) return { forgotten: false };
    // Locked in this tab whatever the service answers.
    try {
      return await forgetKeysOnService([ufvk]);
    } finally {
      lock();
    }
  }, [ufvk, lock]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const value = useMemo<PortalState>(
    () => ({
      ready,
      ufvk,
      meta,
      unlock,
      lock,
      forgetOnService,
      lockReason,
      currency,
      setCurrency,
      recent,
      range,
      reload,
    }),
    [ready, ufvk, meta, unlock, lock, forgetOnService, lockReason, currency, setCurrency, recent, range, reload],
  );
  return <PortalContext.Provider value={value}>{children}</PortalContext.Provider>;
}

export function usePortal(): PortalState {
  const ctx = useContext(PortalContext);
  if (!ctx) throw new Error("usePortal must be used inside PortalProvider");
  return ctx;
}

/** The unlocked key; portal pages render only once unlocked, so this is always set there. */
export function usePortalKey(): string {
  const { ufvk } = usePortal();
  if (!ufvk) throw new Error("usePortalKey needs an unlocked portal");
  return ufvk;
}

/** The person's name for headings and documents: the service's, else the invite's or key file's. */
export function usePersonName(): string | null {
  const { recent, meta } = usePortal();
  return personName(recent.statement, meta);
}
