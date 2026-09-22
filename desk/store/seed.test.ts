import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_DESK_SYMBOLS } from "../config";
import { addWatchSymbol, getDb, listWatchlist, openDb } from "./db";
import { alignDefaultWatchlistPositions, seedEmptyWatchlist, type SeedResolveResult } from "./seed";

const PATH = join(import.meta.dir, "..", "..", "data", "desk-seed-test.sqlite");

function resolved(symbol: string, venue = "alpaca"): SeedResolveResult {
  return {
    ok: true,
    ref: {
      symbol,
      venue,
      assetClass: symbol.includes("BTC") ? "crypto" : "us_equity",
      display: symbol,
    },
  };
}

describe("empty watchlist cold start", () => {
  beforeEach(() => {
    rmSync(PATH, { force: true });
    rmSync(PATH + "-wal", { force: true });
    rmSync(PATH + "-shm", { force: true });
    openDb(PATH);
  });
  afterEach(() => {
    try {
      getDb().close();
    } catch {
      /* ignore */
    }
    rmSync(PATH, { force: true });
    rmSync(PATH + "-wal", { force: true });
    rmSync(PATH + "-shm", { force: true });
  });

  test("default list is the Jerry order", () => {
    expect([...DEFAULT_DESK_SYMBOLS]).toEqual(["NVDA", "TSLA", "QQQ", "SPY", "MSTR", "BTCUSD"]);
  });

  test("empty table seeds DESK_SYMBOLS in order", async () => {
    const result = await seedEmptyWatchlist(DEFAULT_DESK_SYMBOLS, async (sym) =>
      resolved(sym.trim().toUpperCase(), sym.toUpperCase().includes("BTC") ? "coinbase" : "alpaca"),
    );
    expect(result.seeded).toBe(true);
    expect(result.added).toEqual(["NVDA", "TSLA", "QQQ", "SPY", "MSTR", "BTCUSD"]);
    const rows = listWatchlist();
    expect(rows.map((r) => r.symbol)).toEqual(["NVDA", "TSLA", "QQQ", "SPY", "MSTR", "BTCUSD"]);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(rows.every((r) => r.paused === 0)).toBe(true);
  });

  test("DESK_SYMBOLS override replaces the default order on an empty table", async () => {
    const result = await seedEmptyWatchlist(["SPY", "QQQ"], async (sym) => resolved(sym));
    expect(result.added).toEqual(["SPY", "QQQ"]);
    expect(listWatchlist().map((r) => r.symbol)).toEqual(["SPY", "QQQ"]);
  });

  test("non-empty watchlist is not wiped or topped up", async () => {
    addWatchSymbol({
      symbol: "AAPL",
      venue: "alpaca",
      asset_class: "us_equity",
      display: "AAPL",
      position: 4,
      paused: 0,
    });
    let calls = 0;
    const result = await seedEmptyWatchlist(DEFAULT_DESK_SYMBOLS, async (sym) => {
      calls++;
      return resolved(sym);
    });
    expect(result.seeded).toBe(false);
    expect(result.added).toEqual([]);
    expect(calls).toBe(0);
    const rows = listWatchlist();
    expect(rows.map((r) => r.symbol)).toEqual(["AAPL"]);
    expect(rows[0]?.position).toBe(4);
  });

  test("default set stuck at pos 5 is rewritten to Jerry order", () => {
    // Bit9: BTCUSD was position 0 and every equity was stuck at position 5.
    const stuck: Array<[string, number, number]> = [
      ["BTCUSD", 0, 1_000],
      ["MSTR", 5, 5_000],
      ["SPY", 5, 4_000],
      ["QQQ", 5, 3_000],
      ["TSLA", 5, 2_000],
      ["NVDA", 5, 6_000],
    ];
    for (const [symbol, position, added_at] of stuck) {
      addWatchSymbol({
        symbol,
        venue: symbol === "BTCUSD" ? "coinbase" : "unresolved",
        asset_class: symbol === "BTCUSD" ? "crypto" : "us_equity",
        display: symbol,
        position,
        paused: symbol === "BTCUSD" ? 0 : 1,
        added_at,
      });
    }
    expect(listWatchlist().map((r) => r.symbol)[0]).toBe("BTCUSD");
    expect(alignDefaultWatchlistPositions()).toBe(true);
    const rows = listWatchlist();
    expect(rows.map((r) => r.symbol)).toEqual(["NVDA", "TSLA", "QQQ", "SPY", "MSTR", "BTCUSD"]);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(rows.find((r) => r.symbol === "NVDA")?.paused).toBe(1);
    expect(rows.find((r) => r.symbol === "BTCUSD")?.venue).toBe("coinbase");
    expect(alignDefaultWatchlistPositions()).toBe(false);
    expect(listWatchlist().map((r) => r.position)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  test("a different symbol set is not reordered", () => {
    addWatchSymbol({
      symbol: "BTCUSD",
      venue: "coinbase",
      asset_class: "crypto",
      display: "BTCUSD",
      position: 0,
      paused: 0,
    });
    addWatchSymbol({
      symbol: "AAPL",
      venue: "alpaca",
      asset_class: "us_equity",
      display: "AAPL",
      position: 5,
      paused: 0,
    });
    expect(alignDefaultWatchlistPositions()).toBe(false);
    expect(listWatchlist().map((r) => [r.symbol, r.position])).toEqual([
      ["BTCUSD", 0],
      ["AAPL", 5],
    ]);
  });

  test("unresolved names stay in order as paused placeholders", async () => {
    const result = await seedEmptyWatchlist(["NVDA", "TSLA", "BTCUSD"], async (sym) => {
      const canon = sym.toUpperCase();
      if (canon === "TSLA") return { ok: false, reason: "no feed" };
      return resolved(canon, canon === "BTCUSD" ? "coinbase" : "alpaca");
    });
    expect(result.added).toEqual(["NVDA", "TSLA", "BTCUSD"]);
    const rows = listWatchlist();
    expect(rows.map((r) => r.symbol)).toEqual(["NVDA", "TSLA", "BTCUSD"]);
    expect(rows[1]?.venue).toBe("unresolved");
    expect(rows[1]?.paused).toBe(1);
    expect(rows[0]?.position).toBe(0);
    expect(rows[2]?.position).toBe(2);
  });
});
