"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BlockEvent, ConnectionState, Decision, Position, Totals } from "./types";

export type DeskSymbol = {
  symbol: string;
  venue: string;
  assetClass: string;
  display: string;
  position: number;
  paused: boolean;
  addedAt: number;
};

export type DeskBar = {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

export type DeskDecision = {
  id: string;
  symbol: string;
  t: number;
  tf: string;
  action: string;
  p_long: number;
  p_short: number;
  p_flat: number;
  latency_ms: number;
};

export type DeskPosition = {
  symbol: string;
  qty: number;
  avg_price: number;
  realized_usd: number;
  updated_at: number;
};

export type DeskQuote = {
  symbol: string;
  last: number | null;
  prev: number | null;
  /** Percent points. 1.25 means +1.25%. */
  chgPct: number | null;
  /** Bar open time of `last`. Older prints must not overwrite a newer one. */
  asOf: number | null;
};

export type DeskStatus = {
  phase?: number;
  adapters?: Record<string, string>;
  alpacaConfigured?: boolean;
  watchlist?: number;
  sseClients?: number;
  model?: string;
  modelName?: string;
  paper?: { cashUsd?: number; equityUsd?: number };
};

export type DeskState = {
  connection: ConnectionState;
  symbols: DeskSymbol[];
  selected: string | null;
  bars: DeskBar[];
  live: DeskBar | null;
  decisions: DeskDecision[];
  positions: DeskPosition[];
  quotes: Record<string, DeskQuote>;
  status: DeskStatus | null;
  error: string | null;
};

const emptyTotals = (): Totals => ({
  blocks: 0,
  decisions: 0,
  quotes: 0,
  fills: 0,
  reverted: 0,
  lateBlocks: 0,
  jevUsd: 0,
  gasMon: 0,
  gasUsd: 0,
  realizedUsd: 0,
  pnlUsd: 0,
  pnlMon: 0,
  pnlPct: 0,
});

const emptyPos = (): Position => ({
  side: "flat",
  size: 0,
  entryPrice: null,
  unrealizedUsd: 0,
  unrealizedMon: 0,
});

/** Map desk 1m bars into BlockEvent mids so ChartStack can reuse its candle path. */
function barTsMs(t: number): number {
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return Date.now();
  // Desk bars are epoch ms; tolerate seconds.
  return n < 1_000_000_000_000 ? Math.round(n * 1000) : Math.round(n);
}

export function barsToEvents(bars: DeskBar[], live: DeskBar | null): BlockEvent[] {
  const rows =
    live && (!bars.length || bars[bars.length - 1]!.t !== live.t) ? [...bars, live] : bars.slice();
  return rows
    .filter((b) => Number.isFinite(Number(b.c)) && Number.isFinite(Number(b.t)))
    .map((b, i) => ({
      block: i + 1,
      ts: barTsMs(b.t),
      mid: Number(b.c),
      bestBid: Number(b.c),
      bestAsk: Number(b.c),
      spreadBps: 0,
      decision: null,
      quote: null,
      fill: null,
      resting: { bidMon: 0, askMon: 0 },
      position: emptyPos(),
      totals: emptyTotals(),
    }));
}

export function decisionForSymbol(
  decisions: DeskDecision[],
  symbol: string | null,
): DeskDecision | null {
  if (!symbol) return null;
  for (let i = decisions.length - 1; i >= 0; i--) {
    if (decisions[i]!.symbol === symbol) return decisions[i]!;
  }
  return null;
}

export function positionForSymbol(
  positions: DeskPosition[],
  symbol: string | null,
): DeskPosition | null {
  if (!symbol) return null;
  return positions.find((p) => p.symbol === symbol) ?? null;
}

function finiteOrNull(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export function quotesBySymbol(list: DeskQuote[] | null | undefined): Record<string, DeskQuote> {
  const out: Record<string, DeskQuote> = {};
  for (const q of list ?? []) {
    if (!q?.symbol) continue;
    out[q.symbol] = {
      symbol: q.symbol,
      last: finiteOrNull(q.last),
      prev: finiteOrNull(q.prev),
      chgPct: finiteOrNull(q.chgPct),
      asOf: finiteOrNull(q.asOf),
    };
  }
  return out;
}

/** Apply a bar print to the watchlist quote. Ignore bars older than the quote we already have. */
export function applyBarToQuotes(
  quotes: Record<string, DeskQuote>,
  symbol: string,
  bar: { c: number; t: number },
): Record<string, DeskQuote> {
  if (!symbol || !Number.isFinite(bar.c) || !Number.isFinite(bar.t)) return quotes;
  const cur = quotes[symbol];
  if (cur?.asOf != null && bar.t < cur.asOf) return quotes;
  const prev = cur?.prev ?? null;
  const chgPct =
    prev != null && Number.isFinite(prev) && prev !== 0 ? ((bar.c - prev) / prev) * 100 : null;
  if (cur && cur.last === bar.c && cur.asOf === bar.t && cur.chgPct === chgPct) return quotes;
  return {
    ...quotes,
    [symbol]: { symbol, last: bar.c, prev, chgPct, asOf: bar.t },
  };
}

export function feedHint(
  sym: DeskSymbol | undefined,
  status: DeskStatus | null,
  barCount: number,
): string | null {
  if (!sym) return "Pick a symbol";
  if (barCount > 0) return null;
  const alpaca = status?.alpacaConfigured === true;
  const venue = (sym.venue || "").toLowerCase();
  if (sym.symbol === "BTCUSD" || venue === "coinbase") return "No feed yet from Coinbase";
  if (!alpaca || venue === "unresolved") return "No feed · add Alpaca paper keys (ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY) on the desk";
  return "No feed";
}

export function deskDecisionToUi(d: DeskDecision | null): Decision | null {
  if (!d) return null;
  const action =
    d.action === "long" || d.action === "buy"
      ? "buy"
      : d.action === "short" || d.action === "sell"
        ? "sell"
        : "hold";
  return {
    action,
    probabilities: { buy: d.p_long, sell: d.p_short, hold: d.p_flat },
    upIn10: d.p_long,
    latencyMs: d.latency_ms,
    late: false,
  };
}

const initial: DeskState = {
  connection: "connecting",
  symbols: [],
  selected: null,
  bars: [],
  live: null,
  decisions: [],
  positions: [],
  quotes: {},
  status: null,
  error: null,
};

export function useDesk(deskUrl: string) {
  const base = deskUrl.replace(/\/+$/, "");
  const [state, setState] = useState<DeskState>(initial);
  const selectedRef = useRef<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const setSelected = useCallback((symbol: string) => {
    selectedRef.current = symbol;
    setState((s) => ({ ...s, selected: symbol, bars: [], live: null }));
  }, []);

  const loadBars = useCallback(
    async (symbol: string) => {
      try {
        const res = await fetch(
          `${base}/api/bars?symbol=${encodeURIComponent(symbol)}&tf=1m&limit=500`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`bars ${res.status}`);
        const body = (await res.json()) as { bars?: DeskBar[]; live?: DeskBar | null };
        setState((s) =>
          s.selected === symbol
            ? { ...s, bars: body.bars ?? [], live: body.live ?? null, error: null }
            : s,
        );
      } catch (err) {
        setState((s) => ({
          ...s,
          error: err instanceof Error ? err.message : "bars failed",
        }));
      }
    },
    [base],
  );

  const refreshQuotes = useCallback(async () => {
    try {
      const res = await fetch(`${base}/api/quotes`, { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { quotes?: DeskQuote[] };
      const quotes = quotesBySymbol(body.quotes);
      setState((s) => ({ ...s, quotes }));
    } catch {
      /* quote rail can stay dashed */
    }
  }, [base]);

  const refreshSymbols = useCallback(async () => {
    try {
      const res = await fetch(`${base}/api/symbols`, { cache: "no-store" });
      if (!res.ok) throw new Error(`symbols ${res.status}`);
      const body = (await res.json()) as { symbols?: DeskSymbol[] };
      const symbols = body.symbols ?? [];
      setState((s) => {
        const selected =
          s.selected && symbols.some((x) => x.symbol === s.selected)
            ? s.selected
            : (symbols[0]?.symbol ?? null);
        selectedRef.current = selected;
        return { ...s, symbols, selected, error: null };
      });
      void refreshQuotes();
      return symbols;
    } catch (err) {
      setState((s) => ({
        ...s,
        connection: s.connection === "live" ? s.connection : "reconnecting",
        error: err instanceof Error ? err.message : "symbols failed",
      }));
      return [] as DeskSymbol[];
    }
  }, [base, refreshQuotes]);

  const addSymbol = useCallback(
    async (raw: string) => {
      const symbol = raw.trim().toUpperCase();
      if (!symbol) return { ok: false as const, error: "symbol required" };
      const res = await fetch(`${base}/api/symbols`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; symbol?: DeskSymbol };
      if (!res.ok) return { ok: false as const, error: body.error ?? `add failed (${res.status})` };
      await refreshSymbols();
      if (body.symbol?.symbol) setSelected(body.symbol.symbol);
      return { ok: true as const, symbol: body.symbol };
    },
    [base, refreshSymbols, setSelected],
  );

  const removeSymbol = useCallback(
    async (symbol: string) => {
      const res = await fetch(`${base}/api/symbols/${encodeURIComponent(symbol)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        return { ok: false as const, error: body.error ?? `remove failed (${res.status})` };
      }
      await refreshSymbols();
      return { ok: true as const };
    },
    [base, refreshSymbols],
  );

  useEffect(() => {
    let cancelled = false;
    let backoff = 1000;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const connect = async () => {
      if (cancelled) return;
      setState((s) => ({
        ...s,
        connection: s.connection === "live" ? "reconnecting" : "connecting",
      }));
      await refreshSymbols();
      if (cancelled) return;
      if (typeof EventSource === "undefined") return;

      const es = new EventSource(`${base}/events`);
      esRef.current = es;

      es.addEventListener("snapshot", (ev) => {
        try {
          const data = JSON.parse((ev as MessageEvent).data) as {
            symbols?: DeskSymbol[];
            decisions?: DeskDecision[];
            positions?: DeskPosition[];
            quotes?: DeskQuote[];
            status?: DeskStatus;
          };
          setState((s) => {
            const symbols = data.symbols ?? s.symbols;
            const selected =
              (selectedRef.current &&
              symbols.some((x) => x.symbol === selectedRef.current)
                ? selectedRef.current
                : symbols[0]?.symbol) ?? null;
            selectedRef.current = selected;
            return {
              ...s,
              connection: "live",
              symbols,
              selected,
              decisions: data.decisions ?? s.decisions,
              positions: data.positions ?? s.positions,
              quotes: data.quotes ? quotesBySymbol(data.quotes) : s.quotes,
              status: data.status ?? s.status,
              error: null,
            };
          });
          backoff = 1000;
        } catch {
          /* ignore */
        }
      });

      es.addEventListener("status", (ev) => {
        try {
          const status = JSON.parse((ev as MessageEvent).data) as DeskStatus;
          setState((s) => ({ ...s, status, connection: "live" }));
        } catch {
          /* ignore */
        }
      });

      es.addEventListener("watchlist", () => {
        void refreshSymbols();
      });

      es.addEventListener("decision", (ev) => {
        try {
          const payload = JSON.parse((ev as MessageEvent).data) as { decision?: DeskDecision };
          const row = payload.decision;
          if (!row?.id) return;
          setState((s) => ({
            ...s,
            decisions: [...s.decisions.filter((d) => d.id !== row.id), row].slice(-200),
          }));
        } catch {
          /* ignore */
        }
      });

      es.addEventListener("position", (ev) => {
        try {
          const row = JSON.parse((ev as MessageEvent).data) as DeskPosition;
          if (!row?.symbol) return;
          setState((s) => ({
            ...s,
            positions: [...s.positions.filter((p) => p.symbol !== row.symbol), row],
          }));
        } catch {
          /* ignore */
        }
      });

      es.addEventListener("bar", (ev) => {
        try {
          const payload = JSON.parse((ev as MessageEvent).data) as {
            symbol: string;
            tf: string;
            bar: DeskBar;
            live: boolean;
          };
          if (!payload?.symbol || !payload.bar) return;
          setState((s) => {
            const quotes = applyBarToQuotes(s.quotes, payload.symbol, payload.bar);
            const forChart = payload.tf === "1m" && s.selected === payload.symbol;
            if (!forChart) return quotes === s.quotes ? s : { ...s, quotes };
            if (payload.live) return { ...s, quotes, live: payload.bar };
            const bars = [...s.bars.filter((b) => b.t !== payload.bar.t), payload.bar].sort(
              (a, b) => a.t - b.t,
            );
            return { ...s, quotes, bars: bars.slice(-500), live: null };
          });
        } catch {
          /* ignore */
        }
      });

      es.onerror = () => {
        es.close();
        esRef.current = null;
        setState((s) => ({ ...s, connection: "reconnecting" }));
        timer = setTimeout(() => {
          backoff = Math.min(backoff * 2, 10_000);
          void connect();
        }, backoff);
      };
    };

    void connect();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      esRef.current?.close();
      esRef.current = null;
    };
  }, [base, refreshSymbols]);

  useEffect(() => {
    if (state.selected) void loadBars(state.selected);
  }, [state.selected, loadBars]);

  const events = useMemo(() => barsToEvents(state.bars, state.live), [state.bars, state.live]);

  return {
    ...state,
    events,
    setSelected,
    addSymbol,
    removeSymbol,
    refreshSymbols,
    loadBars,
  };
}
