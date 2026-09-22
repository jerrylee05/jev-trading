import { expect, test } from "bun:test";
import { eventMids } from "./eventMids";
import type { BlockEvent } from "./types";

function ev(over: Partial<BlockEvent>): BlockEvent {
  return {
    block: 1,
    ts: 1_000,
    mid: 1,
    bestBid: 1,
    bestAsk: 1,
    spreadBps: 1,
    decision: { action: "hold", probabilities: { buy: 0, sell: 0, hold: 1 }, upIn10: 0.5, latencyMs: 0, late: false },
    quote: null,
    fill: null,
    resting: { bidMon: 0, askMon: 0 },
    levels: { bids: [], asks: [] },
    position: { side: "flat", size: 0, entryPrice: null, unrealizedUsd: 0, unrealizedMon: 0 },
    totals: {
      blocks: 1, decisions: 0, quotes: 0, fills: 0, reverted: 0, lateBlocks: 0,
      jevUsd: 0, gasMon: 0, gasUsd: 0, realizedUsd: 0, pnlUsd: 0, pnlMon: 0, pnlPct: 0,
    },
    ...over,
  };
}

test("eventMids drops late and null mid", () => {
  const rows = eventMids([
    ev({ ts: 1, mid: 10, decision: { action: "buy", probabilities: { buy: 1, sell: 0, hold: 0 }, upIn10: 0.6, latencyMs: 10, late: false } }),
    ev({ ts: 2, mid: 11, decision: { action: "hold", probabilities: { buy: 0, sell: 0, hold: 1 }, upIn10: 0.5, latencyMs: 0, late: true } }),
    ev({ ts: 3, mid: null, decision: { action: "sell", probabilities: { buy: 0, sell: 1, hold: 0 }, upIn10: 0.4, latencyMs: 12, late: false } }),
    ev({ ts: 4, mid: 12, decision: null }),
  ]);
  expect(rows).toEqual([
    { ts: 1, mid: 10 },
    { ts: 4, mid: 12 },
  ]);
});
