"use client";

import { useEffect, useRef } from "react";

// Calls `callback` every `intervalMs` while `enabled`. A slow call is never overlapped by the next.
export function usePolling(callback: () => Promise<void> | void, intervalMs: number, enabled: boolean) {
  const latest = useRef(callback);

  useEffect(() => {
    latest.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;
    let running = false;
    const id = setInterval(async () => {
      if (running) return;
      running = true;
      try {
        await latest.current();
      } finally {
        running = false;
      }
    }, intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs]);
}
