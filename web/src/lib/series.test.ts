import { expect, test } from "bun:test";
import {
  MACD_MIN_POINTS,
  RSI_MIN_POINTS,
  alignReference,
  buildCandles,
  chooseBucket,
  mergeImmutableCandles,
  formatWindow,
  isShortWindow,
  macd,
  rsi,
  spanMs,
} from "./series";

test("candles use only real prints and skip empty buckets", () => {
  const candles = buildCandles(
    [
      { ts: 0, mid: 10 },
      { ts: 400, mid: 12 },
      { ts: 1_000, mid: 9 },
      { ts: 5_000, mid: 11 },
    ],
    1_000,
  );
  expect(candles.map((c) => c.t0)).toEqual([0, 1_000, 5_000]);
  expect(candles[0]).toMatchObject({ open: 10, high: 12, low: 10, close: 12, n: 2, t1: 1_000 });
  expect(candles[1]).toMatchObject({ open: 9, high: 9, low: 9, close: 9, n: 1 });
  expect(candles[2].close).toBe(11);
});

test("bucket follows the observed span", () => {
  expect(chooseBucket(300_000).label).toBe("10s");
  expect(chooseBucket(60_000).label).toBe("2s");
  expect(chooseBucket(5_000).label).toBe("1s");
  expect(chooseBucket(0).label).toBe("1s");
  // Long history (500x1m) exceeds 90-bar cap → coarse 1m, not fine 1s.
  expect(chooseBucket(500 * 60_000).label).toBe("1m");
});

test("short window is about a minute of paper mids", () => {
  expect(isShortWindow(45_000, 80)).toBe(true);
  expect(isShortWindow(120_000, 400)).toBe(false);
  expect(isShortWindow(0, 1)).toBe(true);
  expect(formatWindow(48_000)).toBe("48s");
  expect(formatWindow(125_000)).toBe("2m 5s");
  expect(spanMs([{ ts: 10, mid: 1 }, { ts: 40, mid: 1 }])).toBe(30);
});

test("MACD stays empty until the slow and signal windows exist", () => {
  const up = Array.from({ length: MACD_MIN_POINTS - 1 }, (_, i) => i + 1);
  expect(macd(up).every((p) => p.hist == null)).toBe(true);
  const ready = Array.from({ length: MACD_MIN_POINTS + 5 }, (_, i) => i + 1);
  const series = macd(ready);
  const last = series[series.length - 1];
  expect(last.hist).not.toBeNull();
  expect(last.macd).toBeGreaterThan(0);
});

test("RSI hits the rails on a one-way series", () => {
  const up = Array.from({ length: RSI_MIN_POINTS + 4 }, (_, i) => 100 + i);
  const down = Array.from({ length: RSI_MIN_POINTS + 4 }, (_, i) => 100 - i);
  const upR = rsi(up);
  const downR = rsi(down);
  expect(upR[RSI_MIN_POINTS - 1]).toBe(100);
  expect(downR[RSI_MIN_POINTS - 1]).toBe(0);
  expect(rsi(up.slice(0, RSI_MIN_POINTS - 1)).every((v) => v == null)).toBe(true);
});

test("BTC reference is stepped onto the paper window without extending past the last print", () => {
  const aligned = alignReference(
    [
      { t: 500, p: 10 },
      { t: 1_500, p: 11 },
      { t: 2_500, p: 12 },
      { t: 9_000, p: 99 },
    ],
    1_000,
    3_000,
  );
  expect(aligned.map((p) => p.p)).toEqual([10, 11, 12]);
  expect(aligned[0].t).toBe(1_000);
  expect(aligned[aligned.length - 1].t).toBe(2_500);

  const flat = alignReference([{ t: 100, p: 7 }], 1_000, 2_000);
  expect(flat).toEqual([
    { t: 1_000, p: 7 },
    { t: 2_000, p: 7 },
  ]);
});


test("candles align to wall-clock buckets, not the first print", () => {
  const candles = buildCandles(
    [
      { ts: 1_500, mid: 10 },
      { ts: 1_800, mid: 12 },
      { ts: 2_200, mid: 11 },
    ],
    1_000,
  );
  expect(candles.map((c) => c.t0)).toEqual([1_000, 2_000]);
  expect(candles[0]).toMatchObject({ open: 10, high: 12, low: 10, close: 12, t1: 2_000 });
});

test("closed candles stay fixed when the feed window slides", () => {
  const bucket = 1_000;
  const first = buildCandles(
    [
      { ts: 1_000, mid: 10 },
      { ts: 1_400, mid: 12 },
      { ts: 2_100, mid: 11 },
      { ts: 2_400, mid: 13 },
    ],
    bucket,
  );
  const closed = first.find((c) => c.t0 === 1_000)!;
  expect(closed).toMatchObject({ open: 10, high: 12, low: 10, close: 12 });

  // Window slides: drop early print, add a live print in the 3s bucket.
  const rebuilt = buildCandles(
    [
      { ts: 1_400, mid: 12 },
      { ts: 2_100, mid: 11 },
      { ts: 2_400, mid: 13 },
      { ts: 3_200, mid: 14 },
    ],
    bucket,
  );
  const merged = mergeImmutableCandles(first, rebuilt, 3_200, bucket);
  const still = merged.find((c) => c.t0 === 1_000)!;
  expect(still).toMatchObject({ open: 10, high: 12, low: 10, close: 12, n: 2 });
  const live = merged.find((c) => c.t0 === 3_000)!;
  expect(live.close).toBe(14);
});
