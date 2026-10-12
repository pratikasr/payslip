"use client";

import { createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode } from "react";
import { api, toDisplayError, type ApiError, type Health, type Network, type TreasuryKeyState } from "@/lib/api";

/** What a server render already knows about the service before /api/health answers. */
export interface ServiceHint {
  network?: Network;
  mode?: "full" | "statements";
  treasury?: TreasuryKeyState;
}

interface HealthState {
  health: Health | undefined;
  error: ApiError | undefined;
  loading: boolean;
  refresh: () => void;
  /** The network, from health once it answers, else from the server's hint; undefined while unknown. */
  network: Network | undefined;
  /** "statements" for a deployment with no wallet; undefined while unknown. */
  mode: "full" | "statements" | undefined;
  /**
   * The treasury key's state, from health once it answers, else from the server's hint;
   * undefined while unknown and on services that do not report it.
   */
  treasury: TreasuryKeyState | undefined;
  /** After an unlock, a lock or a new key: health is read again at once, so the stamp and the gates follow. */
  setTreasury: (state: TreasuryKeyState) => void;
}

const HealthContext = createContext<HealthState | null>(null);

const POLL_MS = 30_000;

/**
 * Fetches GET /api/health once for the whole app and refreshes it every 30 s. Health can take a
 * few seconds (it asks lightwalletd for the chain tip), so a layout may pass a `hint` read on the
 * server from a fast endpoint: the network and the mode are then right on the first paint, and
 * nothing claims testnet or mainnet before they are known.
 */
export function HealthProvider({ children, hint }: { children: ReactNode; hint?: ServiceHint }) {
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
  const network = health?.network ?? hint?.network;
  const mode = health ? (health.mode ?? "full") : hint?.mode;
  const treasury = health?.treasury ?? hint?.treasury;
  // The new state shows at once (the service answered it); the next health read confirms it.
  const setTreasury = useCallback((state: TreasuryKeyState) => {
    setHealth((h) => (h ? { ...h, treasury: state } : h));
    setTick((t) => t + 1);
  }, []);
  const value = useMemo(
    () => ({ health, error, loading, refresh, network, mode, treasury, setTreasury }),
    [health, error, loading, refresh, network, mode, treasury, setTreasury],
  );
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
  return ctx?.network === "testnet" ? "TAZ" : "ZEC";
}
