import { deskConfig } from "../config";
import type { Bar, MarketAdapter, OnTick, SymbolRef } from "./types";

const MON_REF: SymbolRef = {
  symbol: "MON-USDC",
  venue: "kuru",
  assetClass: "onchain",
  providerSymbol: "MON-USDC",
  display: "MON-USDC",
};

function normalizeMon(symbol: string): SymbolRef | null {
  const s = symbol.trim().toUpperCase().replace(/[/_]/g, "-");
  if (s === "MON-USDC" || s === "MONUSDC" || s === "MON") return { ...MON_REF };
  return null;
}

/**
 * Subscribe to existing trader SSE and build ticks from mids.
 * Skip late/null mid (Phase 0 rule).
 */
export function createKuruAdapter(): MarketAdapter {
  return {
    id: "kuru",
    capabilities: {
      tfs: ["1s", "5s", "15s", "1m"],
      backfill: false,
      quotes: true,
      sessionAware: false,
    },

    async resolve(symbol: string): Promise<SymbolRef | null> {
      return normalizeMon(symbol);
    },

    async search(q: string): Promise<SymbolRef[]> {
      const ref = normalizeMon(q) ?? (q.toUpperCase().includes("MON") ? normalizeMon("MON-USDC") : null);
      return ref ? [ref] : [];
    },

    async backfill(): Promise<Bar[]> {
      return [];
    },

    async subscribe(refs, onTick): Promise<() => void> {
      const wanted = refs.filter((r) => r.symbol === "MON-USDC");
      if (!wanted.length) return () => {};
      const ref = wanted[0]!;
      const ac = new AbortController();
      let stopped = false;

      const run = async () => {
        while (!stopped) {
          try {
            const res = await fetch(deskConfig.kuruEventsUrl, {
              headers: { accept: "text/event-stream" },
              signal: ac.signal,
            });
            if (!res.ok || !res.body) throw new Error(`kuru sse ${res.status}`);
            const reader = res.body.getReader();
            const dec = new TextDecoder();
            let buf = "";
            let event = "message";
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              buf += dec.decode(value, { stream: true });
              const parts = buf.split("\n");
              buf = parts.pop() ?? "";
              for (const line of parts) {
                if (line.startsWith("event:")) {
                  event = line.slice(6).trim();
                  continue;
                }
                if (line.startsWith("data:")) {
                  const data = line.slice(5).trim();
                  if (!data) continue;
                  handleSse(event, data, ref, onTick);
                  event = "message";
                }
              }
            }
          } catch {
            if (stopped || ac.signal.aborted) return;
            await Bun.sleep(2000);
          }
        }
      };
      void run();

      return () => {
        stopped = true;
        ac.abort();
      };
    },
  };
}

function handleSse(event: string, data: string, ref: SymbolRef, onTick: OnTick) {
  if (event !== "block" && event !== "snapshot" && event !== "message") return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return;
  }
  if (!parsed || typeof parsed !== "object") return;
  const obj = parsed as Record<string, unknown>;

  if (event === "snapshot" && Array.isArray(obj.history)) {
    for (const row of obj.history) ingestBlock(row, ref, onTick);
    return;
  }
  ingestBlock(obj, ref, onTick);
}

function ingestBlock(row: unknown, ref: SymbolRef, onTick: OnTick) {
  if (!row || typeof row !== "object") return;
  const b = row as { mid?: number | null; ts?: number; decision?: { late?: boolean } | null };
  // Phase 0: skip late / null mid
  if (b.decision?.late) return;
  if (b.mid == null || !Number.isFinite(b.mid)) return;
  const t = typeof b.ts === "number" && Number.isFinite(b.ts) ? b.ts : Date.now();
  onTick(ref, { t, price: b.mid, size: 0 });
}
