import type { Bar, MarketAdapter, SymbolRef, Timeframe } from "./types";

const WS_URL = "wss://ws-feed.exchange.coinbase.com";
const REST = "https://api.exchange.coinbase.com";
const HEADERS = { accept: "application/json", "user-agent": "jev-desk" };

const GRANULARITY: Partial<Record<Timeframe, number>> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1h": 3600,
  "1D": 86400,
};

function normalizeBtc(symbol: string): SymbolRef | null {
  const s = symbol.trim().toUpperCase().replace(/[-/_]/g, "");
  if (s === "BTCUSD" || s === "BTCUSDT" || s === "XBTUSD" || s === "BTC") {
    return {
      symbol: "BTCUSD",
      venue: "coinbase",
      assetClass: "crypto",
      providerSymbol: "BTC-USD",
      display: "BTC-USD",
    };
  }
  return null;
}

export function createCoinbaseAdapter(): MarketAdapter {
  return {
    id: "coinbase",
    capabilities: {
      tfs: ["1m", "5m", "15m", "1h", "1D"],
      backfill: true,
      quotes: true,
      sessionAware: false,
    },

    async resolve(symbol: string): Promise<SymbolRef | null> {
      return normalizeBtc(symbol);
    },

    async search(q: string): Promise<SymbolRef[]> {
      const ref = normalizeBtc(q) ?? (q.toUpperCase().includes("BTC") ? normalizeBtc("BTCUSD") : null);
      return ref ? [ref] : [];
    },

    async backfill(ref, tf, from, to): Promise<Bar[]> {
      if (ref.symbol !== "BTCUSD") return [];
      const gran = GRANULARITY[tf];
      if (!gran) return [];
      // Coinbase candles: [ time, low, high, open, close, volume ], max 300 candles per request.
      const bars: Bar[] = [];
      let cursorEnd = Math.floor(to / 1000);
      const startSec = Math.floor(from / 1000);
      for (let page = 0; page < 20 && cursorEnd > startSec; page++) {
        const start = Math.max(startSec, cursorEnd - gran * 300);
        const url =
          `${REST}/products/BTC-USD/candles?granularity=${gran}` +
          `&start=${new Date(start * 1000).toISOString()}&end=${new Date(cursorEnd * 1000).toISOString()}`;
        const res = await fetch(url, {
          headers: HEADERS,
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) break;
        const rows: unknown = await res.json();
        if (!Array.isArray(rows) || rows.length === 0) break;
        let oldest = cursorEnd;
        for (const row of rows) {
          if (!Array.isArray(row)) continue;
          const tSec = Number(row[0]);
          const l = Number(row[1]);
          const h = Number(row[2]);
          const o = Number(row[3]);
          const c = Number(row[4]);
          const v = Number(row[5]);
          if (![tSec, o, h, l, c].every(Number.isFinite)) continue;
          bars.push({ t: tSec * 1000, o, h, l, c, v: Number.isFinite(v) ? v : 0, n: 0, src: "coinbase" });
          oldest = Math.min(oldest, tSec);
        }
        if (oldest >= cursorEnd) break;
        cursorEnd = oldest - 1;
        await Bun.sleep(50);
      }
      bars.sort((a, b) => a.t - b.t);
      // Dedupe by t
      const byT = new Map<number, Bar>();
      for (const b of bars) byT.set(b.t, b);
      return [...byT.values()].sort((a, b) => a.t - b.t);
    },

    async subscribe(refs, onTick, _onBar): Promise<() => void> {
      const wanted = refs.filter((r) => r.symbol === "BTCUSD" || r.providerSymbol === "BTC-USD");
      if (!wanted.length) return () => {};
      const ref = wanted[0]!;
      let closed = false;
      let ws: WebSocket | null = null;
      let retry: ReturnType<typeof setTimeout> | null = null;

      const connect = () => {
        if (closed) return;
        ws = new WebSocket(WS_URL);
        ws.addEventListener("open", () => {
          ws?.send(
            JSON.stringify({
              type: "subscribe",
              product_ids: ["BTC-USD"],
              channels: ["ticker"],
            }),
          );
        });
        ws.addEventListener("message", (ev) => {
          let msg: unknown;
          try {
            msg = JSON.parse(String(ev.data));
          } catch {
            return;
          }
          if (!msg || typeof msg !== "object") return;
          const m = msg as Record<string, unknown>;
          if (m.type !== "ticker") return;
          const price = Number(m.price);
          const t = typeof m.time === "string" ? Date.parse(m.time) : Date.now();
          const size = Number(m.last_size ?? 0);
          if (!Number.isFinite(price) || price <= 0) return;
          onTick(ref, { t: Number.isFinite(t) ? t : Date.now(), price, size: Number.isFinite(size) ? size : 0 });
        });
        ws.addEventListener("close", () => {
          if (closed) return;
          retry = setTimeout(connect, 2000);
        });
        ws.addEventListener("error", () => {
          try { ws?.close(); } catch { /* ignore */ }
        });
      };
      connect();

      return () => {
        closed = true;
        if (retry) clearTimeout(retry);
        try { ws?.close(); } catch { /* ignore */ }
      };
    },
  };
}
