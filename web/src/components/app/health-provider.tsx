"use client";

import { createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode } from "react";
import { api, toDisplayError, type ApiError, type Health } from "@/lib/api";

interface HealthState {
  health: Health | undefined;
  error: ApiError | undefined;
  loading: boolean;
  refresh: () => void;
}

const HealthContext = createContext<HealthState | null>(null);

const POLL_MS = 30_000;

/** Fetches GET /api/health once for the whole app and refreshes it every 30 s. */
export function HealthProvider({ children }: { children: ReactNode }) {
  const [health, setHealth] = useState<Health | undefined>(undefined);
  const [error, setError] = useState<ApiError | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    api
      .health(ctrl.signal)
      .then((h) => {
        setHealth(h);
        setError(undefined);
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        setError(toDisplayError(err));
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    const timer = setTimeout(() => setTick((t) => t + 1), POLL_MS);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const value = useMemo(() => ({ health, error, loading, refresh }), [health, error, loading, refresh]);
  return <HealthContext.Provider value={value}>{children}</HealthContext.Provider>;
}

export function useHealth(): HealthState {
  const ctx = useContext(HealthContext);
  if (!ctx) throw new Error("useHealth must be used inside HealthProvider");
  return ctx;
}

/** The coin's display unit: TAZ on testnet (testnet coins have no value), ZEC otherwise. */
export function useCoinUnit(): "ZEC" | "TAZ" {
  const ctx = useContext(HealthContext);
  return ctx?.health?.network === "testnet" ? "TAZ" : "ZEC";
}
