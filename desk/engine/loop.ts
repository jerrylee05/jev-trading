/**
 * Decision loop: closed DESK_DECISION_TF bar (and optional intrabar timer)
 * -> features -> model -> paper apply -> SSE emit.
 * Paper only. Never places live orders.
 */
import type { Timeframe } from "../adapters/types";
import type { BarAggregator } from "../bars/aggregator";
import { deskConfig } from "../config";
import type { SseHub } from "../http/sse";
import { listWatchlist, queryBars, listPositions, listDecisions, listFills } from "../store/db";
import { buildFeatures, featuresCompact } from "./features";
import { createDeskModel, type DeskModel } from "./model";
import { PaperAccount } from "./paper";

export interface LoopRuntime {
  aggregator: BarAggregator;
  hub: SseHub;
  paper: PaperAccount;
  model: DeskModel;
}

/** Simple promise pool for DESK_JEV_CONCURRENCY. */
async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
  return results;
}

export function createPaperAndModel() {
  const model = createDeskModel();
  const paper = new PaperAccount();
  return { model, paper };
}

export function startDecisionLoop(rt: LoopRuntime): () => void {
  const tf = (deskConfig.decisionTf || "1m") as Timeframe;
  const seenClosed = new Set<string>(); // symbol|t
  const decidedBars = new Set<string>(); // symbol|barT already decided
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const onBar = rt.aggregator.onBar((symbol, barTf, bar, live) => {
    if (live) return;
    if (barTf !== tf) return;
    const key = `${symbol}|${bar.t}`;
    if (seenClosed.has(key)) return;
    seenClosed.add(key);
    // Bound set size
    if (seenClosed.size > 50_000) {
      const first = seenClosed.values().next().value;
      if (first) seenClosed.delete(first);
    }
    void evaluateSymbols([symbol], "closed_bar");
  });

  async function evaluateSymbols(symbols: string[], reason: string) {
    if (running) return;
    running = true;
    try {
      const active = listWatchlist().filter((w) => !w.paused);
      const targets = symbols.length
        ? active.filter((w) => symbols.includes(w.symbol))
        : active;
      if (!targets.length) return;

      await mapPool(targets, deskConfig.jevConcurrency, async (row) => {
        try {
          await evaluateOne(row.symbol, reason);
        } catch (err) {
          console.warn(
            `[desk] decide ${row.symbol} failed:`,
            err instanceof Error ? err.message : err,
          );
        }
      });
      rt.hub.broadcast("status", {
        reason,
        model: rt.model.name,
        paper: rt.paper.snapshot(),
        positions: listPositions().length,
        decisions: listDecisions(1).length,
      });
    } finally {
      running = false;
    }
  }

  async function evaluateOne(symbol: string, reason: string) {
    const bars = queryBars(symbol, tf, 260);
    // Prefer aggregator closed if DB thin (startup race)
    const fromAgg = rt.aggregator.listClosed(symbol, tf, 260);
    const use = bars.length >= fromAgg.length ? bars : fromAgg;
    const features = buildFeatures(symbol, tf, use);
    if (!features) return;

    const decKey = `${symbol}|${features.barT}`;
    // One decision per closed bar open time (boot/intrabar/closed share the key).
    if (decidedBars.has(decKey)) return;
    decidedBars.add(decKey);
    if (decidedBars.size > 50_000) {
      const first = decidedBars.values().next().value;
      if (first) decidedBars.delete(first);
    }

    const decision = await rt.model.decide(features, deskConfig.horizonBars);
    const compact = JSON.stringify(featuresCompact(features));
    const result = rt.paper.apply(symbol, tf, features.barT, features.close, decision, compact);
    rt.paper.tickCooldown(symbol);

    rt.hub.broadcast("decision", {
      reason,
      decision: result.decision,
      probabilities: decision.probabilities,
      model: decision.model,
      latencyMs: decision.latencyMs,
      skipped: result.skipped,
      features: featuresCompact(features),
    });
    if (result.fill) {
      rt.hub.broadcast("fill", result.fill);
    }
    if (result.position) {
      rt.hub.broadcast("position", result.position);
    }
    // score placeholder: horizon window not yet closed; emit pending score status
    rt.hub.broadcast("score", {
      symbol,
      decisionId: result.decision.id,
      horizonBars: deskConfig.horizonBars,
      status: "pending",
    });
  }

  // Intrabar cadence: re-evaluate all symbols on timer (uses latest closed bars)
  if (deskConfig.intrabarMs > 0) {
    timer = setInterval(() => {
      void evaluateSymbols([], "intrabar");
    }, deskConfig.intrabarMs);
  }

  // Kick once shortly after start so mock decisions appear even before next close
  const boot = setTimeout(() => {
    void evaluateSymbols([], "boot");
  }, 1500);

  return () => {
    onBar();
    if (timer) clearInterval(timer);
    clearTimeout(boot);
  };
}

export function paperPublicState(paper: PaperAccount) {
  return {
    ...paper.snapshot(),
    positions: listPositions(),
    decisions: listDecisions(50),
    fills: listFills(50),
  };
}
