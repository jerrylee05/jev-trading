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

/** Newest stored bar for a symbol/timeframe, or null. */
export function latestBar(symbol: string, tf: string): { t: number; c: number } | null {
  const row = getDb()
    .prepare(`SELECT t, c FROM bars WHERE symbol = ? AND tf = ? ORDER BY t DESC LIMIT 1`)
    .get(symbol, tf) as { t: number; c: number } | undefined;
  if (!row || !Number.isFinite(row.c) || !Number.isFinite(row.t)) return null;
  return row;
}

/** Close of the newest bar strictly before `beforeMs`, or null. */
export function closeBefore(symbol: string, tf: string, beforeMs: number): number | null {
  const row = getDb()
    .prepare(`SELECT c FROM bars WHERE symbol = ? AND tf = ? AND t < ? ORDER BY t DESC LIMIT 1`)
    .get(symbol, tf, beforeMs) as { c: number } | undefined;
  if (!row || !Number.isFinite(row.c)) return null;
  return row.c;
}

/**
 * Put `preferred` symbols first, in that order. Anything else keeps its
 * relative order after them. Positions are rewritten 0..n-1.
 */
export function alignWatchlistOrder(preferred: string[]): void {
  const rows = listWatchlist();
  if (!rows.length) return;
  const pref = preferred.map((s) => s.trim().toUpperCase()).filter(Boolean);
  const rank = new Map(pref.map((s, i) => [s, i]));
  const sorted = rows.slice().sort((a, b) => {
    const ra = rank.get(a.symbol.toUpperCase());
    const rb = rank.get(b.symbol.toUpperCase());
    const aRank = ra ?? pref.length + a.position;
    const bRank = rb ?? pref.length + b.position;
    if (aRank !== bRank) return aRank - bRank;
    if (a.added_at !== b.added_at) return a.added_at - b.added_at;
    return a.symbol.localeCompare(b.symbol);
  });
  const update = getDb().prepare(`UPDATE watchlist SET position = ? WHERE symbol = ?`);
  const tx = getDb().transaction(() => {
    sorted.forEach((row, i) => {
      if (row.position !== i) update.run(i, row.symbol);
    });
  });
  tx();
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

export function insertDecision(row: DecisionRow): void {
  getDb()
    .prepare(
      `INSERT INTO decisions (
        id, symbol, t, tf, action, p_long, p_short, p_flat,
        latency_ms, input_tokens, cost_usd, features, horizon_bars, scored_at, outcome
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.symbol,
      row.t,
      row.tf,
      row.action,
      row.p_long,
      row.p_short,
      row.p_flat,
      row.latency_ms,
      row.input_tokens,
      row.cost_usd,
      row.features,
      row.horizon_bars,
      row.scored_at,
      row.outcome,
    );
}

export function insertFill(row: FillRow): void {
  getDb()
    .prepare(
      `INSERT INTO fills (
        id, symbol, t, side, qty, price, slippage_bps, commission_usd, decision_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.symbol,
      row.t,
      row.side,
      row.qty,
      row.price,
      row.slippage_bps,
      row.commission_usd,
      row.decision_id,
    );
}

export function upsertPosition(row: PositionRow): void {
  getDb()
    .prepare(
      `INSERT INTO positions (symbol, qty, avg_price, realized_usd, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(symbol) DO UPDATE SET
         qty=excluded.qty, avg_price=excluded.avg_price,
         realized_usd=excluded.realized_usd, updated_at=excluded.updated_at`,
    )
    .run(row.symbol, row.qty, row.avg_price, row.realized_usd, row.updated_at);
}

export function getPosition(symbol: string): PositionRow | null {
  return (
    (getDb().prepare(`SELECT * FROM positions WHERE symbol = ?`).get(symbol) as PositionRow | undefined) ??
    null
  );
}

/** Simple cash ledger in a one-row meta table (created on demand). */
export function ensureMetaTable(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

export function getCashLedger(): number | null {
  ensureMetaTable();
  const row = getDb().prepare(`SELECT value FROM meta WHERE key = 'cash_usd'`).get() as
    | { value: string }
    | undefined;
  if (!row) return null;
  const n = Number(row.value);
  return Number.isFinite(n) ? n : null;
}

export function setCashLedger(cashUsd: number): void {
  ensureMetaTable();
  getDb()
    .prepare(
      `INSERT INTO meta (key, value) VALUES ('cash_usd', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(String(cashUsd));
}

export function latestDecision(symbol: string): DecisionRow | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM decisions WHERE symbol = ? ORDER BY t DESC LIMIT 1`)
      .get(symbol) as DecisionRow | undefined) ?? null
  );
}
