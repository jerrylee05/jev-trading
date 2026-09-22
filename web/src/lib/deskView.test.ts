import { describe, expect, test } from "bun:test";
import { COPY, UNMAPPED_CHECKS, UNMAPPED_SCORES, buildDesk, buildSpark, shortModelLabel } from "./deskView";
import type { BlockEvent, Meta } from "./types";

const FORBIDDEN = /[·—–]/;

function walk(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) walk(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) walk(x, out);
  return out;
}

function event(over: Partial<BlockEvent> = {}): BlockEvent {
  return {
    block: 105488269,
    ts: 1_700_000_000_000,
    mid: 0.022636,
    bestBid: 0.022628,
    bestAsk: 0.022644,
    spreadBps: 7.07,
    decision: {
      action: "sell",
      probabilities: { buy: 0.11, sell: 0.874, hold: 0.016 },
      upIn10: 0.126,
      latencyMs: 487,
      late: false,
    },
    quote: { side: "sell", price: 0.022643, size: 200, txHash: null, gasMon: 0, cancel: [], status: "sim", orderId: null, capped: false },
    fill: null,
    resting: { bidMon: 0, askMon: 200 },
    levels: {
      bids: [[0.022628, 1240], [0.022621, 890]],
      asks: [[0.022644, 980], [0.022651, 1520]],
    },
    position: { side: "short", size: 200, entryPrice: 0.022633, unrealizedUsd: -0.0006, unrealizedMon: -0.027 },
    totals: { blocks: 1284, decisions: 1281, quotes: 1200, fills: 47, reverted: 0, lateBlocks: 2, jevUsd: 0, gasMon: 0, gasUsd: 0, realizedUsd: 0, pnlUsd: -4.28, pnlMon: 0, pnlPct: 0 },
    ...over,
  };
}

const meta: Meta = {
  model: "jev-latest",
  wallet: null,
  dryRun: true,
  market: "0x065C9d28E428A0db40191a54d33d5b7c71a9C394",
  startedAt: 1,
  bankrollUsd: 10000,
  horizonBlocks: 100,
};

describe("buildDesk", () => {
  test("maps a dry-run snapshot onto the look1 fields", () => {
    const view = buildDesk(meta, event(), [event()], "live", "http://127.0.0.1:3010");
    expect(view.stripe).toBe("PAPER");
    expect(view.dryRunPill).toBe("dryRun=true");
    expect(view.modelPill).toBe("MODEL=jev-latest");
    expect(view.modelIsJev).toBe(true);
    expect(view.action).toBe("SHORT");
    expect(view.confidence).toBe("87.4%");
    expect(view.latency).toBe("487ms");
    expect(view.gateway).toBe("487 ms");
    expect(view.block).toBe("#105,488,269");
    expect(view.paperPnl.text).toBe("-$4.28");
    expect(view.account).toBe("$9,995.72");
    expect(view.horizon).toBe("100 blk (30s)");
    expect(view.upIn10).toBe("0.126");
    expect(view.late.text).toBe("false");
    expect(view.quote.text).toBe("sell sim");
    expect(view.bids[0]).toEqual({ price: "0.022628", size: "1,240", empty: false });
    expect(view.bids[1]?.price).toBe("0.022621");
    expect(view.bids).toHaveLength(2);
    expect(view.asks[0]?.size).toBe("980");
    expect(view.asks).toHaveLength(2);
    expect(view.mid).toBe("0.022636");
    expect(view.spread).toBe("spread 7.07 bps");
    expect(view.positionSide).toBe("SHORT");
    expect(view.size).toBe("200 MON");
    expect(view.entry).toBe("0.022633");
    expect(view.notional).toBe("$4.53");
    expect(view.unrealized.text).toBe("-$0.0006");
    expect(view.resting).toBe("0 / 200");
    expect(view.stats.fills).toBe("47");
    expect(view.stats.fillsLabel).toBe("Fills (sim)");
    expect(view.stats.blockedLate).toBe("- / 2");
    expect(view.spark.marker?.label).toBe("▼ SHORT 87%");
    expect(view.spark.marker?.tone).toBe("short");
    expect(view.spark.entryY).not.toBeNull();
  });

  test("does not invent scores, checklist answers, or example numbers", () => {
    const view = buildDesk(meta, event(), [event()], "live", "http://127.0.0.1:3010");
    expect(UNMAPPED_SCORES.map((r) => r.value)).toEqual(["N/A", "N/A", "N/A"]);
    expect(UNMAPPED_CHECKS.map((r) => r.answer)).toEqual(["N/A", "N/A", "N/A", "N/A"]);
    const text = walk(view).concat(walk(COPY), walk(UNMAPPED_SCORES), walk(UNMAPPED_CHECKS)).join("\n");
    expect(text).not.toMatch(FORBIDDEN);
    expect(text.toUpperCase()).not.toContain("EXAMPLE");
    expect(text).not.toMatch(/0\.72|0\.34|0\.61/);
  });

  test("missing book depth keeps the best bid and ask and leaves size blank", () => {
    const latest = event({ levels: undefined });
    const view = buildDesk(meta, latest, [latest], "live", "http://127.0.0.1:3010");
    expect(view.bids[0]).toEqual({ price: "0.022628", size: "N/A", empty: false });
    expect(view.asks[0]).toEqual({ price: "0.022644", size: "N/A", empty: false });
    expect(view.bids).toHaveLength(1);
    expect(view.asks).toHaveLength(1);
  });

  test("shortens typesafe-ai/jev model pill to MODEL=jev", () => {
    expect(shortModelLabel("typesafe-ai/jev")).toBe("jev");
    const gateway: Meta = { ...meta, model: "typesafe-ai/jev" };
    const view = buildDesk(gateway, event(), [event()], "live", "http://127.0.0.1:3010");
    expect(view.modelPill).toBe("MODEL=jev");
    expect(view.modelIsJev).toBe(true);
  });

  test("empty feed stays paper and does not paint a decision", () => {
    const view = buildDesk(null, null, [], "connecting", "http://127.0.0.1:3010");
    expect(view.stripe).toBe("PAPER");
    expect(view.dryRunPill).toBe("dryRun=N/A");
    expect(view.action).toBe("N/A");
    expect(view.confidence).toBe("N/A");
    expect(view.mid).toBe("N/A");
    expect(view.account).toBe("-");
    expect(view.horizon).toBe("N/A");
    expect(view.spark.line).toBeNull();
    expect(view.banner).toContain("127.0.0.1:3010");
    expect(view.banner).toContain("DRY-RUN");
  });

  test("an explicit live snapshot is not labeled paper", () => {
    const live: Meta = { ...meta, dryRun: false, model: "mock", wallet: "0xabc" };
    const view = buildDesk(live, event(), [event()], "live", "http://127.0.0.1:3010");
    expect(view.stripe).toBe("LIVE");
    expect(view.dryRunPill).toBe("dryRun=false");
    expect(view.modelPill).toBe("MODEL=mock");
    expect(view.modelIsJev).toBe(false);
    expect(view.stats.fillsLabel).toBe("Fills");
    expect(view.banner).toContain("does not send orders");
  });

  test("buckets mids to one point per second and marks a fill", () => {
    const base = 1_700_000_060_000;
    const events: BlockEvent[] = [0, 200, 1100].map((dt, i) =>
      event({
        ts: base + dt,
        mid: 0.0226 + i * 0.00001,
        block: 10 + i,
        fill: i === 2 ? { side: "sell", size: 200, price: 0.02262, txHash: null, orderId: 1, simulated: true } : null,
      }),
    );
    const spark = buildSpark(events, events[2]!.position);
    expect(spark.line).not.toBeNull();
    expect(spark.fills).toHaveLength(1);
    expect(spark.fills[0]?.tone).toBe("short");
    expect(spark.marker?.tone).toBe("short");
  });
});
