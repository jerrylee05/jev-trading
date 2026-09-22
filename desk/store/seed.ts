import type { SymbolRef } from "../adapters/types";
import { DEFAULT_DESK_SYMBOLS } from "../config";
import { addWatchSymbol, listWatchlist, patchWatchSymbol, watchlistCount } from "./db";

export type SeedResolveResult =
  | { ok: true; ref: Pick<SymbolRef, "symbol" | "venue" | "assetClass" | "display"> }
  | { ok: false; reason: string };

export interface SeedWatchlistResult {
  /** True when this boot inserted the cold-start list. */
  seeded: boolean;
  added: string[];
}

/**
 * Cold start for an empty watchlist.
 * Inserts `symbols` in the given order (position 0..n).
 * A non-empty watchlist is left unchanged: no wipe, no top-up of missing names.
 * Unresolved names stay on the rail as paused placeholders so the order is still complete.
 */
export async function seedEmptyWatchlist(
  symbols: readonly string[],
  resolve: (symbol: string) => Promise<SeedResolveResult>,
): Promise<SeedWatchlistResult> {
  if (watchlistCount() > 0) return { seeded: false, added: [] };

  const existing = new Set<string>();
  let pos = 0;
  const added: string[] = [];

  for (const sym of symbols) {
    const canon = sym.trim().toUpperCase();
    if (!canon || existing.has(canon)) continue;

    let outcome: SeedResolveResult;
    try {
      outcome = await resolve(sym);
    } catch (err) {
      outcome = {
        ok: false,
        reason: err instanceof Error ? err.message : "resolve failed",
      };
    }

    if (!outcome.ok) {
      console.warn(`[desk] seed placeholder ${canon}: ${outcome.reason}`);
      addWatchSymbol({
        symbol: canon,
        venue: "unresolved",
        asset_class: canon.includes("BTC") ? "crypto" : "us_equity",
        display: canon,
        position: pos++,
        paused: 1,
      });
      existing.add(canon);
      added.push(canon);
      continue;
    }

    const key = outcome.ref.symbol.toUpperCase();
    if (existing.has(key)) continue;
    addWatchSymbol({
      symbol: outcome.ref.symbol,
      venue: outcome.ref.venue,
      asset_class: outcome.ref.assetClass,
      display: outcome.ref.display,
      position: pos++,
      paused: 0,
    });
    existing.add(key);
    existing.add(canon);
    added.push(outcome.ref.symbol);
  }

  return { seeded: added.length > 0, added };
}

/** True when `rows` is exactly `expected`, ignoring order and position. */
export function sameSymbolSet(rows: { symbol: string }[], expected: readonly string[]): boolean {
  const want = expected.map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (rows.length !== want.length) return false;
  const have = new Set(rows.map((r) => r.symbol.trim().toUpperCase()));
  if (have.size !== want.length) return false;
  return want.every((s) => have.has(s));
}

/**
 * If the saved watchlist is exactly `order` (any positions), rewrite positions to 0..n-1.
 * A different set is left alone. Already-correct positions are not written.
 * Returns true only when at least one row was updated.
 */
export function alignDefaultWatchlistPositions(
  order: readonly string[] = DEFAULT_DESK_SYMBOLS,
): boolean {
  const rows = listWatchlist();
  if (!sameSymbolSet(rows, order)) return false;
  const rank = new Map(order.map((s, i) => [s.trim().toUpperCase(), i]));
  const pending = rows.filter((row) => rank.get(row.symbol.toUpperCase()) !== row.position);
  if (pending.length === 0) return false;
  for (const row of pending) {
    const position = rank.get(row.symbol.toUpperCase());
    if (position === undefined) continue;
    patchWatchSymbol(row.symbol, { position });
  }
  return true;
}
