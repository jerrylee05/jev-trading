import { describe, expect, test } from "bun:test";
import { barsToEvents, deskDecisionToUi, feedHint } from "./useDesk";

describe("useDesk helpers", () => {
  test("barsToEvents appends live bar and maps close to mid", () => {
    const events = barsToEvents(
      [{ t: 1_000, o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }],
      { t: 2_000, o: 1.5, h: 2.5, l: 1.4, c: 2.2, v: 3 },
    );
    expect(events).toHaveLength(2);
    expect(events[0]!.mid).toBe(1.5);
    expect(events[1]!.mid).toBe(2.2);
    expect(events[1]!.ts).toBe(2_000);
  });

  test("deskDecisionToUi maps long/short/flat", () => {
    const ui = deskDecisionToUi({
      id: "1",
      symbol: "NVDA",
      t: 1,
      tf: "1m",
      action: "long",
      p_long: 0.7,
      p_short: 0.2,
      p_flat: 0.1,
      latency_ms: 12,
    });
    expect(ui?.action).toBe("buy");
    expect(ui?.probabilities.buy).toBe(0.7);
    expect(ui?.latencyMs).toBe(12);
  });

  test("feedHint is honest when Alpaca is missing", () => {
    expect(
      feedHint(
        {
          symbol: "NVDA",
          venue: "alpaca",
          assetClass: "us_equity",
          display: "NVDA",
          position: 0,
          paused: false,
          addedAt: 1,
        },
        { alpacaConfigured: false },
        0,
      ),
    ).toContain("Alpaca");
    expect(
      feedHint(
        {
          symbol: "BTCUSD",
          venue: "coinbase",
          assetClass: "crypto",
          display: "BTC",
          position: 0,
          paused: false,
          addedAt: 1,
        },
        { alpacaConfigured: false },
        0,
      ),
    ).toContain("Coinbase");
  });
});
