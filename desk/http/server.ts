import type { BarAggregator } from "../bars/aggregator";
import type { MarketAdapter, SymbolRef, Timeframe } from "../adapters/types";
import { ALL_TFS } from "../adapters/types";
import { resolveSymbol, searchSymbols } from "../adapters/registry";
import { deskConfig } from "../config";
import {
  addWatchSymbol,
  getWatchSymbol,
  insertClosedBar,
  listDecisions,
  listFills,
  listPositions,
  listWatchlist,
  patchWatchSymbol,
  queryBars,
  removeWatchSymbol,
  upsertBar,
  watchlistCount,
  type WatchlistRow,
} from "../store/db";
import { SseHub } from "./sse";

const CORS: HeadersInit = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,authorization",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });

export interface DeskRuntime {
  adapters: MarketAdapter[];
  aggregator: BarAggregator;
  hub: SseHub;
  startedAt: number;
  status: () => Record<string, unknown>;
  /** Re-subscribe after watchlist changes. */
  resubscribe: () => Promise<void>;
}

function rowToPublic(w: WatchlistRow) {
  return {
    symbol: w.symbol,
    venue: w.venue,
    assetClass: w.asset_class,
    display: w.display,
    position: w.position,
    paused: Boolean(w.paused),
    addedAt: w.added_at,
  };
}

function snapshot(rt: DeskRuntime) {
  return {
    startedAt: rt.startedAt,
    model: deskConfig.model,
    decisionTf: deskConfig.decisionTf,
    paperCashUsd: deskConfig.paperCashUsd,
    symbols: listWatchlist().map(rowToPublic),
    positions: listPositions(),
    decisions: listDecisions(50),
    fills: listFills(50),
    status: rt.status(),
  };
}

export function startDeskServer(rt: DeskRuntime) {
  const hub = rt.hub;
  hub.startPing(15_000);

  // Persist closed bars; update live bar in DB as upsert (live only).
  rt.aggregator.onBar((symbol, tf, bar, live) => {
    if (live) upsertBar(symbol, tf, bar);
    else insertClosedBar(symbol, tf, bar);
    hub.broadcast("bar", { symbol, tf, bar, live });
  });

  Bun.serve({
    port: deskConfig.port,
    async fetch(req) {
      const url = new URL(req.url);
      const { pathname } = url;

      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

      if (pathname === "/healthz") {
        return json({ ok: true, port: deskConfig.port, startedAt: rt.startedAt, clients: hub.size });
      }

      if (pathname === "/api/state" && req.method === "GET") {
        return json(snapshot(rt));
      }

      if (pathname === "/api/symbols" && req.method === "GET") {
        return json({ symbols: listWatchlist().map(rowToPublic) });
      }

      if (pathname === "/api/symbols" && req.method === "POST") {
        let body: { symbol?: string };
        try {
          body = (await req.json()) as { symbol?: string };
        } catch {
          return json({ error: "invalid JSON body" }, 400);
        }
        const outcome = await resolveSymbol(rt.adapters, body.symbol ?? "");
        if (!outcome.ok) return json({ error: outcome.reason }, 400);
        if (getWatchSymbol(outcome.ref.symbol)) {
          return json({ error: `symbol already on watchlist: ${outcome.ref.symbol}` }, 400);
        }
        const pos = watchlistCount();
        addWatchSymbol({
          symbol: outcome.ref.symbol,
          venue: outcome.ref.venue,
          asset_class: outcome.ref.assetClass,
          display: outcome.ref.display,
          position: pos,
          paused: 0,
        });
        await maybeBackfill(rt, outcome.ref);
        await rt.resubscribe();
        const row = getWatchSymbol(outcome.ref.symbol)!;
        hub.broadcast("watchlist", { action: "add", symbol: rowToPublic(row) });
        return json({ symbol: rowToPublic(row) }, 201);
      }

      const symMatch = pathname.match(/^\/api\/symbols\/([^/]+)$/);
      if (symMatch) {
        const symbol = decodeURIComponent(symMatch[1]!).toUpperCase();
        if (req.method === "DELETE") {
          const ok = removeWatchSymbol(symbol);
          if (!ok) return json({ error: `not on watchlist: ${symbol}` }, 404);
          await rt.resubscribe();
          hub.broadcast("watchlist", { action: "remove", symbol });
          return json({ ok: true, symbol });
        }
        if (req.method === "PATCH") {
          let body: { paused?: boolean; position?: number };
          try {
            body = (await req.json()) as { paused?: boolean; position?: number };
          } catch {
            return json({ error: "invalid JSON body" }, 400);
          }
          const patched = patchWatchSymbol(symbol, body);
          if (!patched) return json({ error: `not on watchlist: ${symbol}` }, 404);
          await rt.resubscribe();
          hub.broadcast("watchlist", { action: "patch", symbol: rowToPublic(patched) });
          return json({ symbol: rowToPublic(patched) });
        }
      }

      if (pathname === "/api/bars" && req.method === "GET") {
        const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase();
        const tf = (url.searchParams.get("tf") ?? "1m") as Timeframe;
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 300) || 300, 5000);
        const beforeRaw = url.searchParams.get("before");
        const before = beforeRaw ? Number(beforeRaw) : undefined;
        if (!symbol) return json({ error: "symbol is required" }, 400);
        if (!ALL_TFS.includes(tf)) return json({ error: `unsupported tf: ${tf}` }, 400);
        const closed = queryBars(symbol, tf, limit, before);
        const live = rt.aggregator.getLive(symbol, tf);
        return json({ symbol, tf, bars: closed, live });
      }

      if (pathname === "/api/search" && req.method === "GET") {
        const q = url.searchParams.get("q") ?? "";
        const hits = await searchSymbols(rt.adapters, q);
        return json({ q, results: hits });
      }

      if (pathname === "/events" && req.method === "GET") {
        const stream = new ReadableStream<Uint8Array>({
          start(c) {
            hub.add(c);
            hub.send(c, "snapshot", snapshot(rt));
            hub.send(c, "status", rt.status());
          },
          cancel(c) {
            hub.remove(c);
          },
        });
        return new Response(stream, {
          headers: {
            ...CORS,
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          },
        });
      }

      return json({ error: "not found" }, 404);
    },
  });

  console.log(`[desk] listening on http://127.0.0.1:${deskConfig.port}`);
}

async function maybeBackfill(rt: DeskRuntime, ref: SymbolRef) {
  const adapter = rt.adapters.find((a) => a.id === ref.venue) ?? rt.adapters.find((a) => a.capabilities.backfill);
  if (!adapter?.capabilities.backfill) return;
  const to = Date.now();
  const from = to - 2 * 24 * 3600 * 1000;
  try {
    const bars = await adapter.backfill(ref, "1m", from, to);
    for (const bar of bars) {
      // last bar may be live
      const live = bar.t >= floor1m(to);
      rt.aggregator.ingestProviderBar(ref.symbol, "1m", bar, live);
      if (!live) insertClosedBar(ref.symbol, "1m", bar);
    }
  } catch (err) {
    console.warn(`[desk] backfill failed for ${ref.symbol}:`, err instanceof Error ? err.message : err);
  }
}

function floor1m(t: number) {
  return Math.floor(t / 60_000) * 60_000;
}

export { maybeBackfill, snapshot };
