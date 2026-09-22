import { describe, expect, test } from "bun:test";
import { assembleQuote, dayStartMs, pctChange, pickLiveBar, sessionAnchorMs } from "./quotes";

describe("watch quotes", () => {
  test("day start is midnight in the named zone", () => {
    // 2026-01-15 12:00 UTC is 07:00 EST (UTC-5). Midnight EST is 05:00 UTC.
    const estNoon = Date.UTC(2026, 0, 15, 12, 0, 0);
    expect(dayStartMs(estNoon, "America/New_York")).toBe(Date.UTC(2026, 0, 15, 5, 0, 0));
    // 2026-07-15 12:00 UTC is 08:00 EDT (UTC-4). Midnight EDT is 04:00 UTC.
    const edtNoon = Date.UTC(2026, 6, 15, 12, 0, 0);
    expect(dayStartMs(edtNoon, "America/New_York")).toBe(Date.UTC(2026, 6, 15, 4, 0, 0));
    const utcEvening = Date.UTC(2026, 8, 22, 21, 38, 12);
    expect(dayStartMs(utcEvening, "UTC")).toBe(Date.UTC(2026, 8, 22));
  });

  test("equities anchor to the Eastern day of the print; crypto uses UTC", () => {
    const fridayCloseEt = Date.UTC(2026, 0, 16, 21, 0, 0); // Fri 16:00 EST
    expect(sessionAnchorMs(fridayCloseEt, "us_equity")).toBe(Date.UTC(2026, 0, 16, 5, 0, 0));
    expect(sessionAnchorMs(fridayCloseEt, "crypto")).toBe(Date.UTC(2026, 0, 16));
  });

  test("percent change needs both prices and a non-zero reference", () => {
    expect(pctChange(110, 100)).toBeCloseTo(10);
    expect(pctChange(90, 100)).toBeCloseTo(-10);
    expect(pctChange(100, null)).toBeNull();
    expect(pctChange(null, 100)).toBeNull();
    expect(pctChange(100, 0)).toBeNull();
  });

  test("assembleQuote uses live close, else last closed, and prior session close", () => {
    const q = assembleQuote({
      symbol: "NVDA",
      live: { t: 2_000, c: 110 },
      latest: { t: 1_000, c: 105 },
      prevClose: 100,
    });
    expect(q.last).toBe(110);
    expect(q.prev).toBe(100);
    expect(q.chgPct).toBeCloseTo(10);
    expect(q.asOf).toBe(2_000);

    const closedOnly = assembleQuote({
      symbol: "TSLA",
      live: null,
      latest: { t: 1_000, c: 200 },
      prevClose: null,
    });
    expect(closedOnly.last).toBe(200);
    expect(closedOnly.chgPct).toBeNull();
  });

  test("pickLiveBar keeps the newest open", () => {
    expect(
      pickLiveBar([
        { t: 60_000, c: 10 },
        { t: 61_000, c: 11 },
        null,
      ])?.c,
    ).toBe(11);
    expect(pickLiveBar([null, undefined])).toBeNull();
  });
});
