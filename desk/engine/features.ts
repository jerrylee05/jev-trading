/**
 * Compact relative features for desk decisions (TradeState-style).
 * Computed from closed OHLCV bars only.
 */
import type { Bar } from "../adapters/types";

export interface DeskFeatures {
  symbol: string;
  tf: string;
  barT: number;
  close: number;
  /** Close-to-close returns over N bars, in bps. */
  returnsBps: { n1: number; n5: number; n20: number; n60: number };
  /** EMA distance from close in bps (positive = close above EMA). */
  emaDistBps: { ema10: number; ema20: number; ema50: number; ema200: number };
  /** Highest-to-lowest EMA periods joined by >, e.g. "10>20>50>200". */
  emaStack: string;
  rsi14: number;
  macdHist: number;
  macdHistSlope: number;
  atr14Bps: number;
  volumeZ20: number;
  /** 0 = at low, 1 = at high of last bar range. */
  closeInRange: number;
  session: {
    /** US RTH approximate (14:30-21:00 UTC Mon-Fri). */
    isRth: boolean;
    isWeekend: boolean;
    hourUtc: number;
    dow: number;
  };
}

const BPS = 10_000;

function emaSeries(values: number[], period: number): number[] {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0]!;
  out.push(prev);
  for (let i = 1; i < values.length; i++) {
    prev = values[i]! * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function rsi14(closes: number[]): number {
  if (closes.length < 15) return 50;
  let gain = 0;
  let loss = 0;
  for (let i = closes.length - 14; i < closes.length; i++) {
    const d = closes[i]! - closes[i - 1]!;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  if (loss === 0) return 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}

function atr14(bars: Bar[]): number {
  if (bars.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i]!;
    const prev = bars[i - 1]!;
    const tr = Math.max(b.h - b.l, Math.abs(b.h - prev.c), Math.abs(b.l - prev.c));
    trs.push(tr);
  }
  const slice = trs.slice(-14);
  if (!slice.length) return 0;
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function macdHistPair(closes: number[]): { hist: number; slope: number } {
  if (closes.length < 35) return { hist: 0, slope: 0 };
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]!);
  const signal = emaSeries(macdLine, 9);
  const hist = macdLine.map((v, i) => v - signal[i]!);
  const h0 = hist[hist.length - 1] ?? 0;
  const h1 = hist[hist.length - 2] ?? h0;
  return { hist: h0, slope: h0 - h1 };
}

function returnBps(closes: number[], n: number): number {
  if (closes.length <= n) return 0;
  const a = closes[closes.length - 1 - n]!;
  const b = closes[closes.length - 1]!;
  if (!a) return 0;
  return ((b - a) / a) * BPS;
}

function sessionFlags(tMs: number) {
  const d = new Date(tMs);
  const dow = d.getUTCDay(); // 0 Sun
  const hourUtc = d.getUTCHours() + d.getUTCMinutes() / 60;
  const isWeekend = dow === 0 || dow === 6;
  // Approximate US equities RTH in UTC (EST/EDT ignored: 14:30-21:00 UTC covers EST open).
  const isRth = !isWeekend && hourUtc >= 14.5 && hourUtc < 21;
  return { isRth, isWeekend, hourUtc: Math.floor(hourUtc), dow };
}


/**
 * Build features from closed bars ascending by time.
 * Needs enough history for EMA200 (prefer >= 220 bars); degrades gracefully.
 */
export function buildFeatures(symbol: string, tf: string, bars: Bar[]): DeskFeatures | null {
  if (bars.length < 2) return null;
  const sorted = bars.slice().sort((a, b) => a.t - b.t);
  const last = sorted[sorted.length - 1]!;
  const closes = sorted.map((b) => b.c);
  const volumes = sorted.map((b) => b.v);

  const e10 = emaSeries(closes, 10);
  const e20 = emaSeries(closes, 20);
  const e50 = emaSeries(closes, 50);
  const e200 = emaSeries(closes, 200);
  const c = last.c;
  const dist = (ema: number) => (c ? ((c - ema) / c) * BPS : 0);
  const ema10 = e10[e10.length - 1] ?? c;
  const ema20 = e20[e20.length - 1] ?? c;
  const ema50 = e50[e50.length - 1] ?? c;
  const ema200 = e200[e200.length - 1] ?? c;

  const emaLevels = { ema10, ema20, ema50, ema200 };
  // Stack order by EMA value (highest first): classic bull stack is 10>20>50>200 when price rising.
  const emaStack = Object.entries(emaLevels)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k.replace("ema", ""))
    .join(">");

  const atr = atr14(sorted);
  const atr14Bps = c ? (atr / c) * BPS : 0;

  const volWindow = volumes.slice(-20);
  const volMean = volWindow.reduce((a, b) => a + b, 0) / (volWindow.length || 1);
  const volVar =
    volWindow.reduce((a, b) => a + (b - volMean) ** 2, 0) / (volWindow.length || 1);
  const volStd = Math.sqrt(volVar);
  const volumeZ20 = volStd > 0 ? (last.v - volMean) / volStd : 0;

  const range = last.h - last.l;
  const closeInRange = range > 0 ? (last.c - last.l) / range : 0.5;

  const { hist, slope } = macdHistPair(closes);
  // Normalize MACD hist to bps of price for compactness
  const macdHistBps = c ? (hist / c) * BPS : 0;
  const macdSlopeBps = c ? (slope / c) * BPS : 0;

  const emaDistBps = {
    ema10: dist(ema10),
    ema20: dist(ema20),
    ema50: dist(ema50),
    ema200: dist(ema200),
  };

  return {
    symbol,
    tf,
    barT: last.t,
    close: c,
    returnsBps: {
      n1: returnBps(closes, 1),
      n5: returnBps(closes, 5),
      n20: returnBps(closes, 20),
      n60: returnBps(closes, 60),
    },
    emaDistBps,
    emaStack,
    rsi14: rsi14(closes),
    macdHist: round4(macdHistBps),
    macdHistSlope: round4(macdSlopeBps),
    atr14Bps: round4(atr14Bps),
    volumeZ20: round4(volumeZ20),
    closeInRange: round4(closeInRange),
    session: sessionFlags(last.t),
  };
}

function round4(n: number) {
  return Math.round(n * 1e4) / 1e4;
}

/** Compact JSON-ready payload for model input / persistence. */
export function featuresCompact(f: DeskFeatures): Record<string, unknown> {
  return {
    symbol: f.symbol,
    tf: f.tf,
    barT: f.barT,
    close: f.close,
    ret: f.returnsBps,
    emaDist: f.emaDistBps,
    emaStack: f.emaStack,
    rsi14: Math.round(f.rsi14 * 100) / 100,
    macdHist: f.macdHist,
    macdSlope: f.macdHistSlope,
    atr14Bps: f.atr14Bps,
    volZ20: f.volumeZ20,
    closeInRange: f.closeInRange,
    session: f.session,
  };
}

