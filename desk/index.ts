/**
 * Jev Multi-Desk Phase 2 entry.
 * Paper market-data + bar store + HTTP/SSE + decision engine on DESK_PORT (default 3020).
 * Does not start the Monad/Kuru trader loop. Never reads PRIVATE_KEY.
 */
import { BarAggregator } from "./bars/aggregator";
import { createAdapters, resolveSymbol } from "./adapters/registry";
import type { SymbolRef } from "./adapters/types";
import { deskConfig, alpacaConfigured } from "./config";
import { startDeskServer, maybeBackfill } from "./http/server";
import { SseHub } from "./http/sse";
import {
  listWatchlist,
  openDb,
  watchlistCount,
} from "./store/db";
import { reorderDefaultWatchlist, seedEmptyWatchlist } from "./store/seed";
import { createPaperAndModel, startDecisionLoop } from "./engine/loop";
import { resolveDeskModelName } from "./engine/model";

const startedAt = Date.now();
openDb(deskConfig.dbPath);

const adapters = createAdapters();
const aggregator = new BarAggregator();
const hub = new SseHub();
const { model, paper } = createPaperAndModel();

let unsub: (() => void) | null = null;
let stopLoop: (() => void) | null = null;
let adapterStatus: Record<string, string> = {};

function status() {
  return {
    phase: 3,
    adapters: Object.fromEntries(adapters.map((a) => [a.id, adapterStatus[a.id] ?? "idle"])),
    alpacaConfigured: alpacaConfigured(),
    watchlist: watchlistCount(),
    sseClients: hub.size,
    model: resolveDeskModelName(),
    modelName: model.name,
    jevBackend: deskConfig.jevBackend,
    paper: paper.snapshot(),
  };
}

async function seedWatchlist() {
  // Empty table only. A saved watchlist is not rewritten and missing names are not filled back in.
  const result = await seedEmptyWatchlist(deskConfig.symbols, (sym) => resolveSymbol(adapters, sym));
  if (result.added.length) console.log(`[desk] seeded ${result.added.length} watchlist symbol(s)`);
  // Fix Jerry default order when an older DB has the same 6 symbols out of order (e.g. BTCUSD first).
  const re = reorderDefaultWatchlist(deskConfig.symbols);
  if (re.reordered) console.log(`[desk] reordered watchlist → ${re.order.join(",")}`);
}

async function backfillAll() {
  for (const row of listWatchlist()) {
    if (row.paused) continue;
    const outcome = await resolveSymbol(adapters, row.symbol);
    if (!outcome.ok) continue;
    await maybeBackfill(
      { adapters, aggregator, hub, startedAt, status, resubscribe, paper, model },
      outcome.ref,
    );
  }
}

async function resubscribe() {
  if (unsub) {
    try {
      unsub();
    } catch {
      /* ignore */
    }
    unsub = null;
  }

  const rows = listWatchlist().filter((r) => !r.paused);
  const refs: SymbolRef[] = [];
  for (const row of rows) {
    const outcome = await resolveSymbol(adapters, row.symbol);
    if (outcome.ok) refs.push(outcome.ref);
  }

  const byVenue = new Map<string, SymbolRef[]>();
  for (const ref of refs) {
    const list = byVenue.get(ref.venue) ?? [];
    list.push(ref);
    byVenue.set(ref.venue, list);
  }

  const stops: Array<() => void> = [];
  for (const adapter of adapters) {
    const list = byVenue.get(adapter.id) ?? [];
    if (adapter.id === "coinbase") {
      const btc = refs.filter((r) => r.symbol === "BTCUSD");
      if (btc.length && !list.some((r) => r.symbol === "BTCUSD")) {
        if (!alpacaConfigured() || !byVenue.get("alpaca")?.some((r) => r.symbol === "BTCUSD")) {
          list.push(...btc.map((r) => ({ ...r, venue: "coinbase", providerSymbol: "BTC-USD" })));
        }
      }
    }
    if (!list.length) {
      adapterStatus[adapter.id] = "idle";
      continue;
    }
    try {
      const stop = await adapter.subscribe(
        list,
        (ref, tick) => {
          aggregator.onTick(ref.symbol, tick, adapter.id);
        },
        (ref, tf, bar, live) => {
          if (tf === "1m") aggregator.ingestProviderBar(ref.symbol, tf, bar, live);
        },
      );
      stops.push(stop);
      adapterStatus[adapter.id] = `subscribed:${list.map((r) => r.symbol).join(",")}`;
    } catch (err) {
      adapterStatus[adapter.id] = `error:${err instanceof Error ? err.message : "subscribe failed"}`;
      console.warn(`[desk] subscribe ${adapter.id} failed:`, err);
    }
  }
  unsub = () => stops.forEach((s) => s());
  hub.broadcast("status", status());
}

async function main() {
  await seedWatchlist();
  startDeskServer({
    adapters,
    aggregator,
    hub,
    startedAt,
    status,
    resubscribe,
    paper,
    model,
  });
  await backfillAll();
  await resubscribe();
  setInterval(() => aggregator.roll(Date.now()), 250);
  stopLoop = startDecisionLoop({ aggregator, hub, paper, model });
  hub.broadcast("status", status());
  console.log(
    `[desk] Phase 3 ready model=${resolveDeskModelName()}(${model.name}) symbols=${listWatchlist().map((s) => s.symbol).join(",") || "(none)"} paperCash=${paper.cashUsd}`,
  );
}

main().catch((err) => {
  console.error("[desk] fatal", err);
  process.exit(1);
});

void stopLoop;
