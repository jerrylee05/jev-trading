import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

interface Price {
  t: number;
  p: number;
}

interface BtcBody {
  source: "binance" | "coinbase" | null;
  symbol: string | null;
  interval: string | null;
  label: "BTCUSD ref";
  prices: Price[];
  error: string | null;
}

const LABEL = "BTCUSD ref" as const;
const CACHE_MS = 12_000;
const HEADERS = { accept: "application/json", "user-agent": "jev-desk" };

let cache: { at: number; body: BtcBody } | null = null;

function ok(body: Omit<BtcBody, "label" | "error">): BtcBody {
  return { ...body, label: LABEL, error: null };
}

function downsampleSeconds(prices: Price[]): Price[] {
  const bySec = new Map<number, Price>();
  for (const pt of prices) bySec.set(Math.floor(pt.t / 1000), pt);
  return [...bySec.values()].sort((a, b) => a.t - b.t);
}

async function fromBinance(): Promise<BtcBody> {
  const res = await fetch("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1s&limit=500", {
    cache: "no-store",
    headers: HEADERS,
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`binance ${res.status}`);
  const rows: unknown = await res.json();
  if (!Array.isArray(rows)) throw new Error("binance shape");
  const prices: Price[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const t = Number(row[6]);
    const p = Number(row[4]);
    if (Number.isFinite(t) && Number.isFinite(p)) prices.push({ t, p });
  }
  if (prices.length < 2) throw new Error("binance short");
  return ok({ source: "binance", symbol: "BTCUSDT", interval: "1s", prices });
}

/** Public Coinbase trades, paged back far enough to cover the trader's ~5 min mid window. */
async function fromCoinbaseTrades(): Promise<BtcBody> {
  const prices: Price[] = [];
  let after: number | null = null;
  const deadline = Date.now() + 2500;
  let newest = 0;
  let oldest = Number.POSITIVE_INFINITY;
  for (let page = 0; page < 20 && Date.now() < deadline; page++) {
    const url =
      after == null
        ? "https://api.exchange.coinbase.com/products/BTC-USD/trades?limit=100"
        : `https://api.exchange.coinbase.com/products/BTC-USD/trades?limit=100&after=${after}`;
    const res = await fetch(url, {
      cache: "no-store",
      headers: HEADERS,
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`coinbase trades ${res.status}`);
    const rows: unknown = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const rec = row as { price?: string; time?: string; trade_id?: number };
      const p = Number(rec.price);
      const t = typeof rec.time === "string" ? Date.parse(rec.time) : NaN;
      if (Number.isFinite(p) && Number.isFinite(t)) prices.push({ t, p });
    }
    const tail = rows[rows.length - 1] as { trade_id?: number; time?: string };
    const head = rows[0] as { time?: string };
    const id = Number(tail?.trade_id);
    if (!Number.isFinite(id)) break;
    after = id;
    const tOld = typeof tail?.time === "string" ? Date.parse(tail.time) : NaN;
    const tNew = typeof head?.time === "string" ? Date.parse(head.time) : NaN;
    if (Number.isFinite(tNew)) newest = Math.max(newest, tNew);
    if (Number.isFinite(tOld)) oldest = Math.min(oldest, tOld);
    if (newest - oldest >= 8 * 60 * 1000) break;
  }
  const compact = downsampleSeconds(prices);
  if (compact.length < 2) throw new Error("coinbase trades short");
  return ok({ source: "coinbase", symbol: "BTC-USD", interval: "trades", prices: compact });
}

async function fromCoinbaseCandles(): Promise<BtcBody> {
  const res = await fetch("https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60", {
    cache: "no-store",
    headers: HEADERS,
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`coinbase candles ${res.status}`);
  const rows: unknown = await res.json();
  if (!Array.isArray(rows)) throw new Error("coinbase candles shape");
  const prices: Price[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const t = Number(row[0]) * 1000;
    const p = Number(row[4]);
    if (Number.isFinite(t) && Number.isFinite(p)) prices.push({ t, p });
  }
  prices.sort((a, b) => a.t - b.t);
  const slice = prices.slice(-40);
  if (slice.length < 2) throw new Error("coinbase candles short");
  return ok({ source: "coinbase", symbol: "BTC-USD", interval: "1m", prices: slice });
}

async function load(): Promise<BtcBody> {
  const attempts = [fromBinance, fromCoinbaseTrades, fromCoinbaseCandles];
  let last = "BTCUSD reference unavailable";
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (err) {
      last = err instanceof Error ? err.message : last;
    }
  }
  return { source: null, symbol: null, interval: null, label: LABEL, prices: [], error: last };
}

export async function GET() {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return NextResponse.json(cache.body);
  const body = await load();
  if (body.prices.length) cache = { at: now, body };
  else if (cache) return NextResponse.json(cache.body);
  return NextResponse.json(body);
}
