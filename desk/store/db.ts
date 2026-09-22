import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Bar } from "../adapters/types";

export interface WatchlistRow {
  symbol: string;
  venue: string;
  asset_class: string;
  display: string;
  position: number;
  paused: number;
  added_at: number;
}

export interface DecisionRow {
  id: string;
  symbol: string;
  t: number;
  tf: string;
  action: string;
  p_long: number;
  p_short: number;
  p_flat: number;
  latency_ms: number;
  input_tokens: number;
  cost_usd: number;
  features: string;
  horizon_bars: number;
  scored_at: number | null;
  outcome: string | null;
}

export interface FillRow {
  id: string;
  symbol: string;
  t: number;
  side: string;
  qty: number;
  price: number;
  slippage_bps: number;
  commission_usd: number;
  decision_id: string | null;
}

export interface PositionRow {
  symbol: string;
  qty: number;
  avg_price: number;
  realized_usd: number;
  updated_at: number;
}

let db: Database | null = null;

export function openDb(path: string): Database {
  mkdirSync(dirname(path), { recursive: true });
  const d = new Database(path, { create: true });
  d.exec("PRAGMA journal_mode = WAL;");
  d.exec("PRAGMA synchronous = NORMAL;");
  d.exec(`
    CREATE TABLE IF NOT EXISTS bars (
      symbol TEXT NOT NULL,
      tf TEXT NOT NULL,
      t INTEGER NOT NULL,
      o REAL NOT NULL,
      h REAL NOT NULL,
      l REAL NOT NULL,
      c REAL NOT NULL,
      v REAL NOT NULL,
      n INTEGER NOT NULL,
      src TEXT NOT NULL,
      PRIMARY KEY (symbol, tf, t)
    );
    CREATE TABLE IF NOT EXISTS watchlist (
      symbol TEXT PRIMARY KEY,
      venue TEXT NOT NULL,
      asset_class TEXT NOT NULL,
      display TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      paused INTEGER NOT NULL DEFAULT 0,
      added_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      t INTEGER NOT NULL,
      tf TEXT NOT NULL,
      action TEXT NOT NULL,
      p_long REAL NOT NULL,
      p_short REAL NOT NULL,
      p_flat REAL NOT NULL,
      latency_ms REAL NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      features TEXT NOT NULL DEFAULT '{}',
      horizon_bars INTEGER NOT NULL,
      scored_at INTEGER,
      outcome TEXT
    );
    CREATE TABLE IF NOT EXISTS fills (
      id TEXT PRIMARY KEY,
      symbol TEXT NOT NULL,
      t INTEGER NOT NULL,
      side TEXT NOT NULL,
      qty REAL NOT NULL,
      price REAL NOT NULL,
      slippage_bps REAL NOT NULL DEFAULT 0,
      commission_usd REAL NOT NULL DEFAULT 0,
      decision_id TEXT
    );
    CREATE TABLE IF NOT EXISTS positions (
      symbol TEXT PRIMARY KEY,
      qty REAL NOT NULL,
      avg_price REAL NOT NULL,
      realized_usd REAL NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
  `);
  db = d;
  return d;
}

export function getDb(): Database {
  if (!db) throw new Error("desk db not open");
  return db;
}

export function upsertBar(symbol: string, tf: string, bar: Bar): void {
  getDb()
    .prepare(
      `INSERT INTO bars (symbol, tf, t, o, h, l, c, v, n, src)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(symbol, tf, t) DO UPDATE SET
         o=excluded.o, h=excluded.h, l=excluded.l, c=excluded.c,
         v=excluded.v, n=excluded.n, src=excluded.src`,
    )
    .run(symbol, tf, bar.t, bar.o, bar.h, bar.l, bar.c, bar.v, bar.n, bar.src);
}

/** Insert closed bar only if absent (immutability: never rewrite closed). */
export function insertClosedBar(symbol: string, tf: string, bar: Bar): boolean {
  const r = getDb()
    .prepare(
      `INSERT OR IGNORE INTO bars (symbol, tf, t, o, h, l, c, v, n, src)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(symbol, tf, bar.t, bar.o, bar.h, bar.l, bar.c, bar.v, bar.n, bar.src);
  return r.changes > 0;
}

export function queryBars(
  symbol: string,
  tf: string,
  limit: number,
  before?: number,
): Bar[] {
  const lim = Math.max(1, Math.min(limit, 5000));
  if (before != null) {
    return getDb()
      .prepare(
        `SELECT t, o, h, l, c, v, n, src FROM bars
         WHERE symbol = ? AND tf = ? AND t < ?
         ORDER BY t DESC LIMIT ?`,
      )
      .all(symbol, tf, before, lim)
      .reverse() as Bar[];
  }
  return getDb()
    .prepare(
      `SELECT t, o, h, l, c, v, n, src FROM bars
       WHERE symbol = ? AND tf = ?
       ORDER BY t DESC LIMIT ?`,
    )
    .all(symbol, tf, lim)
    .reverse() as Bar[];
}

export function listWatchlist(): WatchlistRow[] {
  return getDb()
    .prepare(`SELECT * FROM watchlist ORDER BY position ASC, added_at ASC`)
    .all() as WatchlistRow[];
}

export function watchlistCount(): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM watchlist`).get() as { n: number };
  return row.n;
}

export function getWatchSymbol(symbol: string): WatchlistRow | null {
  return (
    (getDb().prepare(`SELECT * FROM watchlist WHERE symbol = ?`).get(symbol) as WatchlistRow | undefined) ??
    null
  );
}

export function addWatchSymbol(row: Omit<WatchlistRow, "added_at"> & { added_at?: number }): void {
  const added = row.added_at ?? Date.now();
  getDb()
    .prepare(
      `INSERT INTO watchlist (symbol, venue, asset_class, display, position, paused, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(symbol) DO UPDATE SET
         venue=excluded.venue, asset_class=excluded.asset_class, display=excluded.display,
         position=excluded.position, paused=excluded.paused`,
    )
    .run(row.symbol, row.venue, row.asset_class, row.display, row.position, row.paused, added);
}

export function removeWatchSymbol(symbol: string): boolean {
  const r = getDb().prepare(`DELETE FROM watchlist WHERE symbol = ?`).run(symbol);
  return r.changes > 0;
}

export function patchWatchSymbol(
  symbol: string,
  patch: { paused?: boolean; position?: number },
): WatchlistRow | null {
  const cur = getWatchSymbol(symbol);
  if (!cur) return null;
  const paused = patch.paused === undefined ? cur.paused : patch.paused ? 1 : 0;
  const position = patch.position === undefined ? cur.position : patch.position;
  getDb()
    .prepare(`UPDATE watchlist SET paused = ?, position = ? WHERE symbol = ?`)
    .run(paused, position, symbol);
  return getWatchSymbol(symbol);
}

export function listPositions(): PositionRow[] {
  return getDb().prepare(`SELECT * FROM positions`).all() as PositionRow[];
}

export function listDecisions(limit = 100): DecisionRow[] {
  return getDb()
    .prepare(`SELECT * FROM decisions ORDER BY t DESC LIMIT ?`)
    .all(limit) as DecisionRow[];
}

export function listFills(limit = 100): FillRow[] {
  return getDb().prepare(`SELECT * FROM fills ORDER BY t DESC LIMIT ?`).all(limit) as FillRow[];
}
