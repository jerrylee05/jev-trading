import type { SymbolRef } from "../adapters/types";
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

export interface ReorderResult {
  reordered: boolean;
  order: string[];
}

/**
 * If the watchlist is exactly the Jerry default set (any order / any positions),
 * rewrite positions to match `defaults` (NVDA…BTCUSD). Custom lists are left alone.
 */
export function reorderDefaultWatchlist(defaults: readonly string[]): ReorderResult {
  const want = defaults.map((s) => s.trim().toUpperCase()).filter(Boolean);
  const rows = listWatchlist();
  const have = rows.map((r) => r.symbol.toUpperCase());
  if (want.length === 0 || have.length !== want.length) {
    return { reordered: false, order: have };
  }
  const wantSet = new Set(want);
  if (have.some((s) => !wantSet.has(s))) {
    return { reordered: false, order: have };
  }
  if (have.every((s, i) => s === want[i])) {
    return { reordered: false, order: have };
  }
  for (let i = 0; i < want.length; i++) {
    patchWatchSymbol(want[i]!, { position: 1000 + i });
  }
  for (let i = 0; i < want.length; i++) {
    patchWatchSymbol(want[i]!, { position: i });
  }
  return { reordered: true, order: listWatchlist().map((r) => r.symbol.toUpperCase()) };
}
