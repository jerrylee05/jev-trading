import { describe, expect, test } from "bun:test";
import type { Bar } from "../adapters/types";
import { buildFeatures, featuresCompact } from "./features";

function synthBars(n: number, start = 100, drift = 0.05): Bar[] {
  const out: Bar[] = [];
  let c = start;
  const t0 = Date.UTC(2026, 8, 21, 15, 0, 0); // Mon 15:00 UTC ~ RTH
  for (let i = 0; i < n; i++) {
    const o = c;
    c = c + drift + Math.sin(i / 7) * 0.2;
    const h = Math.max(o, c) + 0.15;
    const l = Math.min(o, c) - 0.15;
    out.push({
      t: t0 + i * 60_000,
      o,
      h,
      l,
      c,
      v: 1000 + (i % 20) * 50,
      n: 10,
      src: "test",
    });
  }
  return out;
}

describe("buildFeatures", () => {
  test("returns null with fewer than 2 bars", () => {
    expect(buildFeatures("NVDA", "1m", [])).toBeNull();
    expect(buildFeatures("NVDA", "1m", synthBars(1))).toBeNull();
  });

  test("computes returns, EMA stack, RSI, MACD, ATR, vol z, range, session", () => {
    const bars = synthBars(220, 100, 0.25); // strong drift dominates sin noise
    const f = buildFeatures("NVDA", "1m", bars);
    expect(f).not.toBeNull();
    if (!f) return;

    expect(f.symbol).toBe("NVDA");
    expect(f.tf).toBe("1m");
    expect(f.close).toBeGreaterThan(100);
    // Uptrend: positive multi-bar returns
    expect(f.returnsBps.n1).not.toBeNaN();
    expect(f.returnsBps.n5).toBeGreaterThan(0);
    expect(f.returnsBps.n20).toBeGreaterThan(0);
    expect(f.emaDistBps.ema10).not.toBeNaN();
    expect(f.emaStack).toMatch(/^\d+(>\d+){3}$/);
    expect(f.rsi14).toBeGreaterThan(50); // uptrend
    expect(f.rsi14).toBeLessThanOrEqual(100);
    expect(typeof f.macdHist).toBe("number");
    expect(typeof f.macdHistSlope).toBe("number");
    expect(f.atr14Bps).toBeGreaterThan(0);
    expect(Number.isFinite(f.volumeZ20)).toBe(true);
    expect(f.closeInRange).toBeGreaterThanOrEqual(0);
    expect(f.closeInRange).toBeLessThanOrEqual(1);
    expect(f.session.isWeekend).toBe(false);
    expect(f.session.isRth).toBe(true);

    const compact = featuresCompact(f);
    expect(compact.emaStack).toBe(f.emaStack);
    expect((compact.ret as { n5: number }).n5).toBe(f.returnsBps.n5);
  });

  test("downtrend yields lower RSI and negative returns", () => {
    const bars = synthBars(80, 200, -0.12);
    const f = buildFeatures("TSLA", "1m", bars)!;
    expect(f.returnsBps.n20).toBeLessThan(0);
    expect(f.rsi14).toBeLessThan(50);
  });

  test("weekend session flag", () => {
    const bars = synthBars(5, 50, 0);
    // Saturday 2026-09-19
    bars.forEach((b, i) => {
      b.t = Date.UTC(2026, 8, 19, 16, i, 0);
    });
    const f = buildFeatures("SPY", "1m", bars)!;
    expect(f.session.isWeekend).toBe(true);
    expect(f.session.isRth).toBe(false);
  });
});
