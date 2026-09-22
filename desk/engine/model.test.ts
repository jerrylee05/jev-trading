import { describe, expect, test } from "bun:test";
import type { DeskFeatures } from "./features";
import { MockDeskModel } from "./model";

function feat(partial: Partial<DeskFeatures> = {}): DeskFeatures {
  return {
    symbol: "NVDA",
    tf: "1m",
    barT: 1_700_000_000_000,
    close: 100,
    returnsBps: { n1: 5, n5: 20, n20: 40, n60: 80 },
    emaDistBps: { ema10: 10, ema20: 20, ema50: 30, ema200: 40 },
    emaStack: "10>20>50>200",
    rsi14: 62,
    macdHist: 2,
    macdHistSlope: 0.5,
    atr14Bps: 15,
    volumeZ20: 0.2,
    closeInRange: 0.7,
    session: { isRth: true, isWeekend: false, hourUtc: 15, dow: 1 },
    ...partial,
  };
}

describe("MockDeskModel", () => {
  test("is deterministic for same barT and returns probabilities summing ~1", async () => {
    const m = new MockDeskModel();
    const a = await m.decide(feat(), 5);
    const b = await m.decide(feat(), 5);
    expect(a.action).toBe(b.action);
    expect(a.probabilities.long).toBeCloseTo(b.probabilities.long, 5);
    const sum = a.probabilities.long + a.probabilities.short + a.probabilities.flat;
    expect(sum).toBeCloseTo(1, 5);
    expect(["long", "short", "flat"]).toContain(a.action);
  });

  test("strong down features prefer short more often than uptrend", async () => {
    const m = new MockDeskModel();
    const up = await m.decide(
      feat({ returnsBps: { n1: 10, n5: 40, n20: 80, n60: 120 }, rsi14: 70, macdHist: 5 }),
      5,
    );
    const down = await m.decide(
      feat({
        barT: 1_700_000_060_000,
        returnsBps: { n1: -10, n5: -40, n20: -80, n60: -120 },
        rsi14: 30,
        macdHist: -5,
        macdHistSlope: -1,
      }),
      5,
    );
    expect(up.probabilities.long).toBeGreaterThan(down.probabilities.long);
    expect(down.probabilities.short).toBeGreaterThan(up.probabilities.short);
  });
});
