"use client";

import { useEffect, useState } from "react";

export interface BtcPoint {
  t: number;
  p: number;
}

export interface BtcFeed {
  points: BtcPoint[];
  source: string | null;
  symbol: string | null;
  interval: string | null;
  error: string | null;
  status: "idle" | "live" | "error";
}

const EMPTY: BtcFeed = {
  points: [],
  source: null,
  symbol: null,
  interval: null,
  error: null,
  status: "idle",
};

/** Public BTCUSD reference only. Never touches the MON trade path. Off until the desk enables it. */
export function useBtc(enabled: boolean, pollMs = 15_000): BtcFeed {
  const [state, setState] = useState<BtcFeed>(EMPTY);

  useEffect(() => {
    if (!enabled) {
      setState(EMPTY);
      return;
    }
    let dead = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const res = await fetch("/api/btcusd", { cache: "no-store" });
        const body = (await res.json()) as {
          prices?: BtcPoint[];
          source?: string;
          symbol?: string;
          interval?: string;
          error?: string;
        };
        if (dead) return;
        const points = Array.isArray(body.prices) ? body.prices : [];
        setState({
          points,
          source: typeof body.source === "string" ? body.source : null,
          symbol: typeof body.symbol === "string" ? body.symbol : null,
          interval: typeof body.interval === "string" ? body.interval : null,
          error: typeof body.error === "string" ? body.error : null,
          status: points.length ? "live" : "error",
        });
      } catch {
        if (!dead) {
          setState((prev) => ({
            ...prev,
            status: prev.points.length ? "live" : "error",
            error: prev.error ?? "BTCUSD reference unavailable",
          }));
        }
      } finally {
        if (!dead) timer = setTimeout(tick, pollMs);
      }
    };

    void tick();
    return () => {
      dead = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, pollMs]);

  return state;
}
