"use client";

import { useEffect, useRef } from "react";
import type { StreamState } from "@/hooks/use-run-events";
import type { Run } from "@/lib/api";

const POLL_MS = 5_000;

/**
 * Keeps a run fresh when its live stream is not: the service allows a limited number of open
 * streams (503 too_many_streams beyond that) and a stream can drop. While the stream is not live
 * and the run can still change, `reload` runs every 5 seconds; once the stream is back it stops.
 */
export function useRunPoll(run: Run | undefined, stream: StreamState, reload: () => void) {
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);
  const settled = !run || run.status === "paid" || run.status === "cancelled";
  const live = stream === "live";
  useEffect(() => {
    if (settled || live) return;
    const timer = setInterval(() => reloadRef.current(), POLL_MS);
    return () => clearInterval(timer);
  }, [settled, live]);
}
