import type { Bar, Tick, Timeframe } from "../adapters/types";
import { DERIVED_TFS, TICK_TFS } from "../adapters/types";

export const TF_MS: Record<Timeframe, number> = {
  "1s": 1_000,
  "5s": 5_000,
  "15s": 15_000,
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "1D": 86_400_000,
};

export function floorTime(tMs: number, tf: Timeframe): number {
  const ms = TF_MS[tf];
  return Math.floor(tMs / ms) * ms;
}

function cloneBar(b: Bar): Bar {
  return { t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, n: b.n, src: b.src };
}

export type BarListener = (symbol: string, tf: Timeframe, bar: Bar, live: boolean) => void;

/**
 * Ticks -> 1s/5s/15s live bars.
 * 1m comes from provider (ingestProviderBar).
 * 5m/15m/1h/1D derived from closed 1m.
 * Closed bars are immutable; exactly one live bar per TF per symbol.
 */
export class BarAggregator {
  private live = new Map<string, Bar>(); // key = symbol|tf
  private closed = new Map<string, Map<number, Bar>>(); // key = symbol|tf -> t -> bar
  private listeners: BarListener[] = [];

  onBar(fn: BarListener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== fn);
    };
  }

  private emit(symbol: string, tf: Timeframe, bar: Bar, live: boolean) {
    const snap = cloneBar(bar);
    for (const fn of this.listeners) fn(symbol, tf, snap, live);
  }

  private key(symbol: string, tf: Timeframe) {
    return `${symbol}|${tf}`;
  }

  getLive(symbol: string, tf: Timeframe): Bar | null {
    const b = this.live.get(this.key(symbol, tf));
    return b ? cloneBar(b) : null;
  }

  getClosed(symbol: string, tf: Timeframe, t: number): Bar | null {
    const m = this.closed.get(this.key(symbol, tf));
    const b = m?.get(t);
    return b ? cloneBar(b) : null;
  }

  /** Snapshot of closed bars (immutable copies), ascending. */
  listClosed(symbol: string, tf: Timeframe, limit = 500): Bar[] {
    const m = this.closed.get(this.key(symbol, tf));
    if (!m) return [];
    return [...m.values()]
      .sort((a, b) => a.t - b.t)
      .slice(-limit)
      .map(cloneBar);
  }

  onTick(symbol: string, tick: Tick, src = "tick") {
    for (const tf of TICK_TFS) this.applyTick(symbol, tf, tick, src);
  }

  private applyTick(symbol: string, tf: Timeframe, tick: Tick, src: string) {
    const open = floorTime(tick.t, tf);
    const k = this.key(symbol, tf);
    let live = this.live.get(k);

    if (live && live.t !== open) {
      this.closeLive(symbol, tf, live);
      live = undefined;
    }

    if (!live) {
      live = {
        t: open,
        o: tick.price,
        h: tick.price,
        l: tick.price,
        c: tick.price,
        v: tick.size ?? 0,
        n: 1,
        src,
      };
      this.live.set(k, live);
      this.emit(symbol, tf, live, true);
      return;
    }

    // Mutate only the live bar.
    live.h = Math.max(live.h, tick.price);
    live.l = Math.min(live.l, tick.price);
    live.c = tick.price;
    live.v += tick.size ?? 0;
    live.n += 1;
    this.emit(symbol, tf, live, true);
  }

  private closeLive(symbol: string, tf: Timeframe, bar: Bar) {
    const k = this.key(symbol, tf);
    const store = this.closed.get(k) ?? new Map<number, Bar>();
    if (!store.has(bar.t)) {
      const frozen = cloneBar(bar);
      store.set(frozen.t, frozen);
      this.closed.set(k, store);
      this.emit(symbol, tf, frozen, false);
      if (tf === "1m") this.deriveFromClosed1m(symbol, frozen);
    }
    this.live.delete(k);
  }

  /**
   * Ingest a 1m bar from a provider. Closed bars are write-once.
   * Live 1m updates replace the live slot only.
   */
  ingestProviderBar(symbol: string, tf: Timeframe, bar: Bar, live: boolean) {
    if (tf !== "1m" && !DERIVED_TFS.includes(tf) && !TICK_TFS.includes(tf)) return;
    if (tf === "1m") {
      if (live) {
        const k = this.key(symbol, "1m");
        const existingLive = this.live.get(k);
        if (existingLive && existingLive.t !== bar.t) {
          this.closeLive(symbol, "1m", existingLive);
        }
        this.live.set(k, cloneBar(bar));
        this.emit(symbol, "1m", bar, true);
        return;
      }
      const k = this.key(symbol, "1m");
      const store = this.closed.get(k) ?? new Map<number, Bar>();
      if (store.has(bar.t)) return; // immutable: ignore rewrite
      const frozen = cloneBar(bar);
      store.set(frozen.t, frozen);
      this.closed.set(k, store);
      if (this.live.get(k)?.t === bar.t) this.live.delete(k);
      this.emit(symbol, "1m", frozen, false);
      this.deriveFromClosed1m(symbol, frozen);
      return;
    }
    // Direct closed tick-tf or derived seed (backfill)
    if (!live) {
      const k = this.key(symbol, tf);
      const store = this.closed.get(k) ?? new Map<number, Bar>();
      if (store.has(bar.t)) return;
      const frozen = cloneBar(bar);
      store.set(frozen.t, frozen);
      this.closed.set(k, store);
      this.emit(symbol, tf, frozen, false);
    }
  }

  private deriveFromClosed1m(symbol: string, m1: Bar) {
    for (const tf of DERIVED_TFS) {
      const open = floorTime(m1.t, tf);
      const k = this.key(symbol, tf);
      const store = this.closed.get(k) ?? new Map<number, Bar>();
      // Higher TF stays live until its bucket ends; we keep a live derived bar.
      let live = this.live.get(k);
      if (live && live.t !== open) {
        if (!store.has(live.t)) {
          const frozen = cloneBar(live);
          store.set(frozen.t, frozen);
          this.closed.set(k, store);
          this.emit(symbol, tf, frozen, false);
        }
        live = undefined;
      }
      if (!live) {
        live = {
          t: open,
          o: m1.o,
          h: m1.h,
          l: m1.l,
          c: m1.c,
          v: m1.v,
          n: m1.n,
          src: `derived:${m1.src}`,
        };
        this.live.set(k, live);
        this.emit(symbol, tf, live, true);
        continue;
      }
      // live same bucket: extend from newly closed 1m (only if this 1m is new contribution)
      live.h = Math.max(live.h, m1.h);
      live.l = Math.min(live.l, m1.l);
      live.c = m1.c;
      live.v += m1.v;
      live.n += m1.n;
      this.emit(symbol, tf, live, true);
    }
  }

  /** Force-close any live bars whose open is before `now` bucket for that TF. */
  roll(now = Date.now()) {
    for (const [k, bar] of [...this.live.entries()]) {
      const [symbol, tf] = k.split("|") as [string, Timeframe];
      const open = floorTime(now, tf);
      if (bar.t < open) this.closeLive(symbol, tf, bar);
    }
  }
}
