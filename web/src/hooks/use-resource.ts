"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, toDisplayError } from "@/lib/api";

export interface Resource<T> {
  data: T | undefined;
  error: ApiError | undefined;
  loading: boolean;
  /** Fetch again. Keeps the previous data visible while loading. */
  reload: () => Promise<void>;
  /** Replace the cached value, for example after a mutation returns it. */
  setData: (value: T | ((prev: T | undefined) => T)) => void;
}

/**
 * Load a value from the service on mount and on demand. Aborts the request
 * when the component unmounts or a newer request starts.
 */
export function useResource<T>(fetcher: (signal: AbortSignal) => Promise<T>, key: string): Resource<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const controller = useRef<AbortController | null>(null);
  const fetcherRef = useRef(fetcher);
  // Keep the latest fetcher without re-running the load effect on every render.
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const run = useCallback(async () => {
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    setLoading(true);
    try {
      const value = await fetcherRef.current(ctrl.signal);
      if (ctrl.signal.aborted) return;
      setDataState(value);
      setError(undefined);
    } catch (err) {
      if (ctrl.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) return;
      setError(toDisplayError(err));
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run();
    return () => controller.current?.abort();
  }, [run, key]);

  const setData = useCallback((value: T | ((prev: T | undefined) => T)) => {
    setDataState((prev) => (typeof value === "function" ? (value as (p: T | undefined) => T)(prev) : value));
  }, []);

  return { data, error, loading, reload: run, setData };
}
