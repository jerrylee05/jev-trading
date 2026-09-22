/** Shared market-data adapter contracts for Jev Multi-Desk (Phase 1). */

export type Timeframe = "1s" | "5s" | "15s" | "1m" | "5m" | "15m" | "1h" | "1D";

export const TICK_TFS: Timeframe[] = ["1s", "5s", "15s"];
export const PROVIDER_TFS: Timeframe[] = ["1m"];
export const DERIVED_TFS: Timeframe[] = ["5m", "15m", "1h", "1D"];
export const ALL_TFS: Timeframe[] = [...TICK_TFS, ...PROVIDER_TFS, ...DERIVED_TFS];

/** Closed or live OHLCV bar. `t` is bar open time in unix milliseconds. */
export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  n: number;
  src: string;
}

export interface Tick {
  t: number;
  price: number;
  size?: number;
}

export interface SymbolRef {
  /** Canonical user key (NVDA, BTCUSD, MON-USDC). */
  symbol: string;
  venue: string;
  assetClass: "us_equity" | "crypto" | "onchain" | "unknown";
  /** Provider-native id when different from symbol (e.g. BTC/USD). */
  providerSymbol: string;
  display: string;
}

export interface AdapterCapabilities {
  tfs: Timeframe[];
  backfill: boolean;
  quotes: boolean;
  sessionAware: boolean;
}

export type OnTick = (ref: SymbolRef, tick: Tick) => void;
export type OnBar = (ref: SymbolRef, tf: Timeframe, bar: Bar, live: boolean) => void;

export interface MarketAdapter {
  id: string;
  capabilities: AdapterCapabilities;
  resolve(symbol: string): Promise<SymbolRef | null>;
  subscribe(refs: SymbolRef[], onTick: OnTick, onBar: OnBar): Promise<() => void>;
  backfill(ref: SymbolRef, tf: Timeframe, from: number, to: number): Promise<Bar[]>;
  clock?(): Promise<{ ts: number; isOpen?: boolean; nextOpen?: number; nextClose?: number }>;
  search?(q: string): Promise<SymbolRef[]>;
}
