import { describe, expect, test } from "bun:test";
import { chgTone, fmtChgPct, fmtLast } from "./watchlist";

describe("watchlist format", () => {
  test("last and change use an ASCII dash when missing", () => {
    expect(fmtLast(null)).toBe("-");
    expect(fmtLast(Number.NaN)).toBe("-");
    expect(fmtChgPct(null)).toBe("-");
    expect(fmtChgPct(undefined)).toBe("-");
  });

  test("last groups thousands and change is signed", () => {
    expect(fmtLast(178.4)).toBe("178.40");
    expect(fmtLast(95432.126)).toBe("95,432.13");
    expect(fmtLast(0.0226)).toBe("0.0226");
    expect(fmtChgPct(1.25)).toBe("+1.25%");
    expect(fmtChgPct(-0.4)).toBe("-0.40%");
    expect(fmtChgPct(0)).toBe("0.00%");
  });

  test("tone is up, down, or flat", () => {
    expect(chgTone(0.01)).toBe("up");
    expect(chgTone(-0.01)).toBe("dn");
    expect(chgTone(0)).toBe("flat");
    expect(chgTone(null)).toBe("flat");
  });
});
