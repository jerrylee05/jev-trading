/** Paper-mid candles and indicators. Nothing here invents samples outside the feed. */

export interface TimedPrice {
  ts: number;
  mid: number;
}

export interface Candle {
  /** Bucket start, ms. */
  t0: number;
  /** Bucket end, ms. Equal to t0 + bucket. Not a fabricated print. */
  t1: number;
  open: number;
  high: number;
  low: number;
  close: number;
  n: number;
}

export interface MacdPoint {
  macd: number | null;
  signal: number | null;
  hist: number | null;
}

export interface RefPoint {
  t: number;
  p: number;
}

export const SHORT_WINDOW_MS = 90_000;
export const RSI_PERIOD = 14;
/** First RSI value lands at index `period` (one prior close per change). */
export const RSI_MIN_POINTS = RSI_PERIOD + 1;
export const MACD_FAST = 12;
export const MACD_SLOW = 26;
export const MACD_SIGNAL = 9;
/** Slow EMA starts at index 25; the signal EMA then needs 9 MACD values (index 33). */
export const MACD_MIN_POINTS = MACD_SLOW + MACD_SIGNAL - 1;

const BUCKETS: { ms: number; label: string }[] = [
  { ms: 1_000, label: "1s" },
  { ms: 2_000, label: "2s" },
  { ms: 5_000, label: "5s" },
  { ms: 10_000, label: "10s" },
  { ms: 15_000, label: "15s" },
  { ms: 30_000, label: "30s" },
  { ms: 60_000, label: "1m" },
];

export function spanMs(points: TimedPrice[]): number {
  if (points.length < 2) return 0;
  return Math.max(0, points[points.length - 1].ts - points[0].ts);
}

/** About a minute or less of paper mids. Callers must say so and must not backfill. */
export function isShortWindow(span: number, count: number): boolean {
  if (count < 2) return true;
  return span < SHORT_WINDOW_MS;
}

export function formatWindow(span: number): string {
  const s = Math.max(0, Math.round(span / 1000));
  if (s < 90) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem ? `${m}m ${rem}s` : `${m}m`;
}

/**
 * Pick a real bucket that fills the plot with bars from the observed span.
 * The trader retains about 1000 blocks (~5 min), so 1m is used only when that
 * many real minutes are actually present.
 */
export function chooseBucket(span: number): { bucketMs: number; label: string } {
  const asBucket = (b: { ms: number; label: string }) => ({ bucketMs: b.ms, label: b.label });
  const fallback = asBucket(BUCKETS[0]);
  if (span <= 0) return fallback;
  const target = 40;
  let best = fallback;
  let bestScore = Infinity;
  let found = false;
  for (const b of BUCKETS) {
    const bars = span / b.ms;
    if (bars < 8 || bars > 90) continue;
    const score = Math.abs(bars - target);
    if (score < bestScore) {
      best = asBucket(b);
      bestScore = score;
      found = true;
    }
  }
  return found ? best : fallback;
}

/** Group real mids into OHLC buckets. Missing buckets are omitted, not filled. */
export function buildCandles(points: TimedPrice[], bucketMs: number): Candle[] {
  if (!points.length || bucketMs <= 0) return [];
  const sorted = points
    .filter((p) => Number.isFinite(p.ts) && Number.isFinite(p.mid))
    .slice()
    .sort((a, b) => a.ts - b.ts);
  if (!sorted.length) return [];
  const origin = sorted[0].ts;
  const out: Candle[] = [];
  for (const p of sorted) {
    const idx = Math.floor((p.ts - origin) / bucketMs);
    const t0 = origin + idx * bucketMs;
    const last = out[out.length - 1];
    if (!last || last.t0 !== t0) {
      out.push({
        t0,
        t1: t0 + bucketMs,
        open: p.mid,
        high: p.mid,
        low: p.mid,
        close: p.mid,
        n: 1,
      });
    } else {
      if (p.mid > last.high) last.high = p.mid;
      if (p.mid < last.low) last.low = p.mid;
      last.close = p.mid;
      last.n += 1;
    }
  }
  return out;
}

/** SMA-seeded EMA. Null until `period` samples exist. */
export function ema(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function macd(
  values: number[],
  fast = MACD_FAST,
  slow = MACD_SLOW,
  signalPeriod = MACD_SIGNAL,
): MacdPoint[] {
  const fastE = ema(values, fast);
  const slowE = ema(values, slow);
  const line: Array<number | null> = values.map((_, i) =>
    fastE[i] != null && slowE[i] != null ? (fastE[i] as number) - (slowE[i] as number) : null,
  );
  const defined: number[] = [];
  const definedIdx: number[] = [];
  for (let i = 0; i < line.length; i++) {
    const m = line[i];
    if (m != null) {
      defined.push(m);
      definedIdx.push(i);
    }
  }
  const sig = ema(defined, signalPeriod);
  const out: MacdPoint[] = line.map((m) => ({ macd: m, signal: null, hist: null }));
  for (let j = 0; j < definedIdx.length; j++) {
    const s = sig[j];
    if (s == null) continue;
    const i = definedIdx[j];
    const m = line[i] as number;
    out[i] = { macd: m, signal: s, hist: m - s };
  }
  return out;
}

/** Wilder RSI. Null until `period` changes have been seen. Flat loss gives 100, flat gain gives 0. */
export function rsi(values: number[], period = RSI_PERIOD): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (period <= 0 || values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = values[i] - values[i - 1];
    if (ch >= 0) gain += ch;
    else loss -= ch;
  }
  let avgG = gain / period;
  let avgL = loss / period;
  const at = (g: number, l: number) => (l === 0 ? 100 : 100 - 100 / (1 + g / l));
  out[period] = at(avgG, avgL);
  for (let i = period + 1; i < values.length; i++) {
    const ch = values[i] - values[i - 1];
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
    out[i] = at(avgG, avgL);
  }
  return out;
}

/**
 * Carry the BTC reference onto the paper window. A price from before the window
 * is stepped in at t0 (last known public print). No point is invented past the
 * last real print except a single flat segment when only one price is known.
 */
export function alignReference(prices: RefPoint[], t0: number, t1: number): RefPoint[] {
  if (!prices.length || !(t1 > t0)) return [];
  const sorted = prices
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.p))
    .slice()
    .sort((a, b) => a.t - b.t);
  if (!sorted.length) return [];
  let prior: RefPoint | null = null;
  const inside: RefPoint[] = [];
  for (const pt of sorted) {
    if (pt.t < t0) prior = pt;
    else if (pt.t <= t1) inside.push(pt);
  }
  const out: RefPoint[] = [];
  if (prior) out.push({ t: t0, p: prior.p });
  for (const pt of inside) out.push(pt);
  if (!out.length) return [];
  if (out.length === 1) out.push({ t: t1, p: out[0].p });
  return out;
}
