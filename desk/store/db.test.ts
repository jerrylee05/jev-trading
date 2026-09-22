import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  insertClosedBar,
  openDb,
  queryBars,
  upsertBar,
  addWatchSymbol,
  listWatchlist,
  removeWatchSymbol,
  getDb,
} from "./db";

const PATH = join(import.meta.dir, "..", "..", "data", "desk-test.sqlite");

describe("sqlite upsert", () => {
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

  test("upsertBar updates same PK; insertClosedBar is write-once", () => {
    const t = 1_700_000_000_000;
    upsertBar("NVDA", "1m", { t, o: 1, h: 2, l: 1, c: 1.5, v: 10, n: 1, src: "live" });
    upsertBar("NVDA", "1m", { t, o: 1, h: 3, l: 0.5, c: 2, v: 20, n: 2, src: "live" });
    let rows = queryBars("NVDA", "1m", 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.h).toBe(3);
    expect(rows[0]?.c).toBe(2);

    // closed insert ignore rewrite
    const ok1 = insertClosedBar("NVDA", "1m", {
      t: t + 60_000,
      o: 2,
      h: 2,
      l: 2,
      c: 2,
      v: 1,
      n: 1,
      src: "alpaca",
    });
    const ok2 = insertClosedBar("NVDA", "1m", {
      t: t + 60_000,
      o: 9,
      h: 9,
      l: 9,
      c: 9,
      v: 9,
      n: 9,
      src: "alpaca",
    });
    expect(ok1).toBe(true);
    expect(ok2).toBe(false);
    rows = queryBars("NVDA", "1m", 10);
    const closed = rows.find((b) => b.t === t + 60_000);
    expect(closed?.c).toBe(2);
  });

  test("watchlist seed helpers", () => {
    addWatchSymbol({
      symbol: "NVDA",
      venue: "alpaca",
      asset_class: "us_equity",
      display: "NVDA",
      position: 0,
      paused: 0,
    });
    expect(listWatchlist()).toHaveLength(1);
    expect(removeWatchSymbol("NVDA")).toBe(true);
    expect(listWatchlist()).toHaveLength(0);
  });
});
