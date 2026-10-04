"use client";

import { useEffect, useRef, useState } from "react";
import { api, type Run, type RunLogEvent } from "@/lib/api";

export type StreamState = "connecting" | "live" | "reconnecting" | "closed";

const MAX_LOGS = 200;
const MAX_BACKOFF_MS = 30_000;

/**
 * Subscribe to GET /api/runs/{id}/events. The "snapshot" event carries the
 * full Run; "log" carries {at, message}. EventSource retries on its own while
 * the connection is merely interrupted; when the browser gives up (the server
 * refused or closed the stream) this hook reconnects with backoff.
 */
export function useRunEvents(runId: string, enabled = true) {
  const [run, setRun] = useState<Run | undefined>(undefined);
  const [logs, setLogs] = useState<RunLogEvent[]>([]);
  const [state, setState] = useState<StreamState>("connecting");
  const attempt = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setState("closed");
      return;
    }
    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      setState(attempt.current === 0 ? "connecting" : "reconnecting");
      source = new EventSource(api.runEventsUrl(runId));

      source.onopen = () => {
        attempt.current = 0;
        setState("live");
      };

      source.addEventListener("snapshot", (event) => {
        try {
          setRun(JSON.parse((event as MessageEvent<string>).data) as Run);
        } catch {
          // Ignore a malformed frame; the next snapshot replaces it.
        }
      });

      source.addEventListener("log", (event) => {
        try {
          const entry = JSON.parse((event as MessageEvent<string>).data) as RunLogEvent;
          setLogs((prev) => {
            if (prev.some((p) => p.at === entry.at && p.message === entry.message)) return prev;
            const next = [...prev, entry];
            return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next;
          });
        } catch {
          // Ignore malformed log frames.
        }
      });

      source.onerror = () => {
        if (!source) return;
        if (source.readyState === EventSource.CLOSED) {
          source.close();
          source = null;
          attempt.current += 1;
          const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(attempt.current, 5));
          setState("reconnecting");
          timer = setTimeout(connect, delay);
        } else {
          setState("reconnecting");
        }
      };
    };

    connect();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      source?.close();
    };
  }, [runId, enabled]);

  return { run, logs, state };
}
