import { describe, expect, test } from "bun:test";
import { toTvSymbol } from "./tvSymbol";

describe("toTvSymbol", () => {
  test("maps the desk watchlist onto TradingView symbols", () => {
    expect(toTvSymbol("BTCUSD")).toBe("COINBASE:BTCUSD");
    expect(toTvSymbol("nvda")).toBe("NASDAQ:NVDA");
    expect(toTvSymbol("TSLA")).toBe("NASDAQ:TSLA");
    expect(toTvSymbol("QQQ")).toBe("NASDAQ:QQQ");
    expect(toTvSymbol("SPY")).toBe("AMEX:SPY");
    expect(toTvSymbol("MSTR")).toBe("NASDAQ:MSTR");
  });

  test("leaves unmapped tickers unknown", () => {
    expect(toTvSymbol("MON-USDC")).toBeNull();
    expect(toTvSymbol("MON")).toBeNull();
    expect(toTvSymbol("AAPL")).toBeNull();
    expect(toTvSymbol(null)).toBeNull();
    expect(toTvSymbol("  ")).toBeNull();
  });
});
