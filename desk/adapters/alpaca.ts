import { deskConfig, alpacaConfigured } from "../config";
import { TokenBucket } from "./rateLimit";
import type {
  Bar,
  MarketAdapter,
  OnBar,
  OnTick,
  SymbolRef,
  Timeframe,
} from "./types";

const REST = "https://data.alpaca.markets";
const TRADE_REST = () => deskConfig.alpaca.tradeUrl;
const STOCK_WS = "wss://stream.data.alpaca.markets/v2/iex";
const CRYPTO_WS = "wss://stream.data.alpaca.markets/v1beta3/crypto/us";

const TF_MAP: Partial<Record<Timeframe, string>> = {
  "1m": "1Min",
  "5m": "5Min",
  "15m": "15Min",
  "1h": "1Hour",
  "1D": "1Day",
};

function authHeaders(): HeadersInit {
  return {
    "APCA-API-KEY-ID": deskConfig.alpaca.keyId,
    "APCA-API-SECRET-KEY": deskConfig.alpaca.secret,
    accept: "application/json",
  };
}

function isCryptoSymbol(sym: string): boolean {
  const s = sym.toUpperCase().replace(/[-/]/g, "");
  return /^(BTC|ETH|SOL|DOGE|AVAX|LINK|DOT|UNI|AAVE|LTC|BCH|XRP|ADA|MATIC|SHIB|PEPE)/.test(s) &&
    (s.endsWith("USD") || s.endsWith("USDT") || s.includes("USD"));
}

function toCryptoPair(sym: string): string {
  const s = sym.toUpperCase().replace(/[-/]/g, "");
  if (s.endsWith("USD") && !s.endsWith("USDT")) return `${s.slice(0, -3)}/USD`;
  if (s.endsWith("USDT")) return `${s.slice(0, -4)}/USDT`;
  return sym.includes("/") ? sym.toUpperCase() : `${sym.toUpperCase()}/USD`;
}

function fromCryptoPair(pair: string): string {
  return pair.replace("/", "").toUpperCase();
}

export function createAlpacaAdapter(): MarketAdapter {
  const bucket = TokenBucket.perMinute(200);

  return {
    id: "alpaca",
    capabilities: {
      tfs: ["1m", "5m", "15m", "1h", "1D"],
      backfill: true,
      quotes: true,
      sessionAware: true,
    },

    async resolve(symbol: string): Promise<SymbolRef | null> {
      if (!alpacaConfigured()) return null;
      const raw = symbol.trim().toUpperCase();
      if (!raw) return null;

      if (isCryptoSymbol(raw) || raw.includes("/")) {
        const pair = toCryptoPair(raw);
        await bucket.take();
        const url = `${REST}/v1beta3/crypto/us/latest/quotes?symbols=${encodeURIComponent(pair)}`;
        const res = await fetch(url, { headers: authHeaders(), signal: AbortSignal.timeout(8000) });
        if (!res.ok) return null;
        const body = (await res.json()) as { quotes?: Record<string, unknown> };
        if (!body.quotes || !body.quotes[pair]) return null;
        const canon = fromCryptoPair(pair);
        return {
          symbol: canon === "BTCUSD" || raw === "BTCUSD" ? "BTCUSD" : canon,
          venue: "alpaca",
          assetClass: "crypto",
          providerSymbol: pair,
          display: pair,
        };
      }

      await bucket.take();
      const res = await fetch(`${TRADE_REST()}/v2/assets/${encodeURIComponent(raw)}`, {
        headers: authHeaders(),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const asset = (await res.json()) as {
        symbol?: string;
        status?: string;
        class?: string;
        tradable?: boolean;
        name?: string;
      };
      if (!asset.symbol || asset.status !== "active") return null;
      return {
        symbol: asset.symbol.toUpperCase(),
        venue: "alpaca",
        assetClass: asset.class === "crypto" ? "crypto" : "us_equity",
        providerSymbol: asset.symbol.toUpperCase(),
        display: asset.name ? `${asset.symbol} (${asset.name})` : asset.symbol,
      };
    },

    async search(q: string): Promise<SymbolRef[]> {
      if (!alpacaConfigured() || !q.trim()) return [];
      await bucket.take();
      const res = await fetch(
        `${TRADE_REST()}/v2/assets?status=active&asset_class=us_equity`,
        { headers: authHeaders(), signal: AbortSignal.timeout(10000) },
      );
      if (!res.ok) return [];
      const rows = (await res.json()) as Array<{ symbol?: string; name?: string; tradable?: boolean }>;
      const needle = q.trim().toUpperCase();
      return rows
        .filter((a) => a.symbol && a.tradable !== false && (a.symbol.includes(needle) || (a.name ?? "").toUpperCase().includes(needle)))
        .slice(0, 25)
        .map((a) => ({
          symbol: a.symbol!.toUpperCase(),
          venue: "alpaca",
          assetClass: "us_equity" as const,
          providerSymbol: a.symbol!.toUpperCase(),
          display: a.name ? `${a.symbol} (${a.name})` : a.symbol!,
        }));
    },

    async backfill(ref, tf, from, to): Promise<Bar[]> {
      if (!alpacaConfigured()) return [];
      const alpacaTf = TF_MAP[tf];
      if (!alpacaTf) return [];
      await bucket.take();
      const start = new Date(from).toISOString();
      const end = new Date(to).toISOString();
      const bars: Bar[] = [];

      if (ref.assetClass === "crypto") {
        const url =
          `${REST}/v1beta3/crypto/us/bars?symbols=${encodeURIComponent(ref.providerSymbol)}` +
          `&timeframe=${alpacaTf}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&limit=10000`;
        const res = await fetch(url, { headers: authHeaders(), signal: AbortSignal.timeout(15000) });
        if (!res.ok) return [];
        const body = (await res.json()) as { bars?: Record<string, Array<Record<string, unknown>>> };
        const rows = body.bars?.[ref.providerSymbol] ?? [];
        for (const r of rows) {
          const t = Date.parse(String(r.t));
          if (!Number.isFinite(t)) continue;
          bars.push({
            t,
            o: Number(r.o),
            h: Number(r.h),
            l: Number(r.l),
            c: Number(r.c),
            v: Number(r.v ?? 0),
            n: Number(r.n ?? 0),
            src: "alpaca",
          });
        }
        return bars;
      }

      const feed = deskConfig.alpaca.feed || "iex";
      const url =
        `${REST}/v2/stocks/${encodeURIComponent(ref.providerSymbol)}/bars` +
        `?timeframe=${alpacaTf}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}` +
        `&limit=10000&adjustment=raw&feed=${encodeURIComponent(feed)}`;
      const res = await fetch(url, { headers: authHeaders(), signal: AbortSignal.timeout(15000) });
      if (!res.ok) return [];
      const body = (await res.json()) as { bars?: Array<Record<string, unknown>> | null };
      for (const r of body.bars ?? []) {
        const t = Date.parse(String(r.t));
        if (!Number.isFinite(t)) continue;
        bars.push({
          t,
          o: Number(r.o),
          h: Number(r.h),
          l: Number(r.l),
          c: Number(r.c),
          v: Number(r.v ?? 0),
          n: Number(r.n ?? 0),
          src: "alpaca",
        });
      }
      return bars;
    },

    async clock() {
      if (!alpacaConfigured()) return { ts: Date.now() };
      await bucket.take();
      const res = await fetch(`${TRADE_REST()}/v2/clock`, {
        headers: authHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { ts: Date.now() };
      const body = (await res.json()) as {
        timestamp?: string;
        is_open?: boolean;
        next_open?: string;
        next_close?: string;
      };
      return {
        ts: body.timestamp ? Date.parse(body.timestamp) : Date.now(),
        isOpen: body.is_open,
        nextOpen: body.next_open ? Date.parse(body.next_open) : undefined,
        nextClose: body.next_close ? Date.parse(body.next_close) : undefined,
      };
    },

    async subscribe(refs, onTick, onBar): Promise<() => void> {
      if (!alpacaConfigured() || refs.length === 0) return () => {};
      const equities = refs.filter((r) => r.assetClass === "us_equity");
      const cryptos = refs.filter((r) => r.assetClass === "crypto");
      const stops: Array<() => void> = [];
      if (equities.length) stops.push(await openStockWs(equities, onTick, onBar));
      if (cryptos.length) stops.push(await openCryptoWs(cryptos, onTick, onBar));
      return () => stops.forEach((s) => s());
    },
  };
}

function openStockWs(refs: SymbolRef[], onTick: OnTick, _onBar: OnBar): Promise<() => void> {
  return new Promise((resolve) => {
    const byProvider = new Map(refs.map((r) => [r.providerSymbol, r]));
    let closed = false;
    const ws = new WebSocket(STOCK_WS);
    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          action: "auth",
          key: deskConfig.alpaca.keyId,
          secret: deskConfig.alpaca.secret,
        }),
      );
    });
    ws.addEventListener("message", (ev) => {
      let msgs: unknown;
      try {
        msgs = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      const list = Array.isArray(msgs) ? msgs : [msgs];
      for (const msg of list) {
        if (!msg || typeof msg !== "object") continue;
        const m = msg as Record<string, unknown>;
        if (m.T === "success" && m.msg === "authenticated") {
          ws.send(
            JSON.stringify({
              action: "subscribe",
              trades: [...byProvider.keys()],
              quotes: [...byProvider.keys()],
            }),
          );
          continue;
        }
        if (m.T === "t" || m.T === "q") {
          const sym = String(m.S ?? "");
          const ref = byProvider.get(sym);
          if (!ref) continue;
          const price = m.T === "t" ? Number(m.p) : Number(m.ap ?? m.bp);
          const t = m.t ? Date.parse(String(m.t)) : Date.now();
          if (!Number.isFinite(price) || price <= 0) continue;
          onTick(ref, { t, price, size: m.T === "t" ? Number(m.s ?? 0) : 0 });
        }
      }
    });
    ws.addEventListener("close", () => {
      closed = true;
    });
    resolve(() => {
      if (!closed) try { ws.close(); } catch { /* ignore */ }
    });
  });
}

function openCryptoWs(refs: SymbolRef[], onTick: OnTick, _onBar: OnBar): Promise<() => void> {
  return new Promise((resolve) => {
    const byProvider = new Map(refs.map((r) => [r.providerSymbol, r]));
    let closed = false;
    const ws = new WebSocket(CRYPTO_WS);
    ws.addEventListener("open", () => {
      ws.send(
        JSON.stringify({
          action: "auth",
          key: deskConfig.alpaca.keyId,
          secret: deskConfig.alpaca.secret,
        }),
      );
    });
    ws.addEventListener("message", (ev) => {
      let msgs: unknown;
      try {
        msgs = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      const list = Array.isArray(msgs) ? msgs : [msgs];
      for (const msg of list) {
        if (!msg || typeof msg !== "object") continue;
        const m = msg as Record<string, unknown>;
        if (m.T === "success" && m.msg === "authenticated") {
          ws.send(
            JSON.stringify({
              action: "subscribe",
              trades: [...byProvider.keys()],
              quotes: [...byProvider.keys()],
            }),
          );
          continue;
        }
        if (m.T === "t" || m.T === "q") {
          const sym = String(m.S ?? "");
          const ref = byProvider.get(sym);
          if (!ref) continue;
          const price = m.T === "t" ? Number(m.p) : Number(m.ap ?? m.bp);
          const t = m.t ? Date.parse(String(m.t)) : Date.now();
          if (!Number.isFinite(price) || price <= 0) continue;
          onTick(ref, { t, price, size: m.T === "t" ? Number(m.s ?? 0) : 0 });
        }
      }
    });
    ws.addEventListener("close", () => {
      closed = true;
    });
    resolve(() => {
      if (!closed) try { ws.close(); } catch { /* ignore */ }
    });
  });
}
