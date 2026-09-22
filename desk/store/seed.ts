import type { SymbolRef } from "../adapters/types";
import { addWatchSymbol, watchlistCount } from "./db";

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
