"use client";

import { useEffect, useState } from "react";

export interface BtcPrice {
  t: number;
  p: number;
}

export interface BtcState {
  prices: BtcPrice[];
  source: string | null;
  symbol: string | null;
  interval: string | null;
  error: string | null;
  status: "loading" | "live" | "down";
}

const EMPTY: BtcState = {
  prices: [],
  source: null,
  symbol: null,
  interval: null,
  error: null,
  status: "loading",
};

/**
 * Public BTCUSD reference for the chart overlay. Polled from this app's proxy
 * so the browser does not need an exchange key. It never feeds the MON order path.
 */
export function useBtc(pollMs = 15_000): BtcState {
  const [state, setState] = useState<BtcState>(EMPTY);

  useEffect(() => {
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const res = await fetch("/api/btcusd", { cache: "no-store" });
        const body = (await res.json()) as Partial<BtcState> & { prices?: BtcPrice[] };
        if (closed) return;
        const prices = Array.isArray(body.prices) ? body.prices : [];
        setState({
          prices,
          source: typeof body.source === "string" ? body.source : null,
          symbol: typeof body.symbol === "string" ? body.symbol : null,
          interval: typeof body.interval === "string" ? body.interval : null,
          error: typeof body.error === "string" ? body.error : null,
          status: prices.length ? "live" : "down",
        });
      } catch {
        if (!closed) {
          setState((prev) => ({
            ...prev,
            status: prev.prices.length ? "live" : "down",
            error: prev.error ?? "BTCUSD reference unavailable",
          }));
        }
      } finally {
        if (!closed) timer = setTimeout(tick, pollMs);
      }
    };

    void tick();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
    };
  }, [pollMs]);

  return state;
}
