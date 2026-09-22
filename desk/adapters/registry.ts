import { createAlpacaAdapter } from "./alpaca";
import { createCoinbaseAdapter } from "./coinbase";
import { createKuruAdapter } from "./kuru";
import type { MarketAdapter, SymbolRef } from "./types";

export interface ResolveResult {
  ok: true;
  ref: SymbolRef;
  adapter: MarketAdapter;
}

export interface ResolveFail {
  ok: false;
  reason: string;
}

export type ResolveOutcome = ResolveResult | ResolveFail;

export function createAdapters(): MarketAdapter[] {
  return [createAlpacaAdapter(), createCoinbaseAdapter(), createKuruAdapter()];
}

/**
 * Canonical key = user string (NVDA, BTCUSD, MON-USDC).
 * Try adapters in order: kuru (MON), coinbase (BTCUSD fallback), alpaca (stocks/crypto).
 */
export async function resolveSymbol(
  adapters: MarketAdapter[],
  symbol: string,
): Promise<ResolveOutcome> {
  const raw = symbol.trim();
  if (!raw) return { ok: false, reason: "symbol is required" };
  if (raw.length > 32) return { ok: false, reason: "symbol too long" };
  if (!/^[A-Za-z0-9._/-]+$/.test(raw)) {
    return { ok: false, reason: "symbol has invalid characters" };
  }

  const byId = new Map(adapters.map((a) => [a.id, a]));
  const order = ["kuru", "coinbase", "alpaca"];

  for (const id of order) {
    const adapter = byId.get(id);
    if (!adapter) continue;
    try {
      const ref = await adapter.resolve(raw);
      if (ref) return { ok: true, ref, adapter };
    } catch {
      // try next
    }
  }
  return { ok: false, reason: `unknown or unsupported symbol: ${raw.toUpperCase()}` };
}

export async function searchSymbols(adapters: MarketAdapter[], q: string): Promise<SymbolRef[]> {
  const needle = q.trim();
  if (!needle) return [];
  const out: SymbolRef[] = [];
  const seen = new Set<string>();
  for (const adapter of adapters) {
    if (!adapter.search) continue;
    try {
      const hits = await adapter.search(needle);
      for (const h of hits) {
        if (seen.has(h.symbol)) continue;
        seen.add(h.symbol);
        out.push(h);
      }
    } catch {
      // ignore adapter search errors
    }
  }
  return out.slice(0, 40);
}
