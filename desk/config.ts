/**
 * Desk env. Reuses src/config for Jev/AI key handling.
 * Paper only: never reads PRIVATE_KEY.
 */
import { loadEnvLocal } from "../src/env";

loadEnvLocal();

// Import shared AI/model config without copying key logic.
import { config as rootConfig } from "../src/config";

const env = (key: string, fallback?: string) => process.env[key] ?? fallback;
const num = (key: string, fallback: number) => {
  const v = env(key);
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const bool = (key: string, fallback: boolean) => {
  const v = env(key)?.trim().toLowerCase();
  if (v === undefined || v === "") return fallback;
  return v === "true" || v === "1" || v === "yes";
};

function parseSymbols(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

/** Jerry lock default order. DESK_SYMBOLS overrides the empty-table insert. Boot rewrites positions to this order only when the saved set matches it exactly. */
export const DEFAULT_DESK_SYMBOLS = ["NVDA", "TSLA", "QQQ", "SPY", "MSTR", "BTCUSD"] as const;

export const deskConfig = {
  port: num("DESK_PORT", 3020),
  /** DESK_SYMBOLS override, or DEFAULT_DESK_SYMBOLS. Seeded only into an empty watchlist. */
  symbols: parseSymbols(env("DESK_SYMBOLS", DEFAULT_DESK_SYMBOLS.join(","))),
  decisionTf: (env("DESK_DECISION_TF", "1m") ?? "1m") as string,
  horizonBars: num("DESK_HORIZON_BARS", 5),
  intrabarMs: num("DESK_INTRABAR_MS", 5000),
  jevConcurrency: num("DESK_JEV_CONCURRENCY", 3),
  paperCashUsd: num("DESK_PAPER_CASH_USD", 100_000),
  notionalUsd: num("DESK_NOTIONAL_USD", 10_000),
  slippageBps: num("DESK_SLIPPAGE_BPS", 2),
  commissionUsd: num("DESK_COMMISSION_USD", 0),
  flipThreshold: num("DESK_FLIP_THRESHOLD", 0.6),
  cooldownBars: num("DESK_COOLDOWN_BARS", 2),
  extendedHours: bool("DESK_EXTENDED_HOURS", false),
  /** Shared with trader: mock | jev */
  model: rootConfig.model,
  jevBackend: rootConfig.jevBackend,
  jevEvaluationModelId: rootConfig.jevEvaluationModelId,
  alpaca: {
    keyId: env("ALPACA_API_KEY_ID", "")!.trim(),
    secret: env("ALPACA_API_SECRET_KEY", "")!.trim(),
    feed: (env("ALPACA_DATA_FEED", "iex") ?? "iex").toLowerCase(),
    /** Trading/assets API host. Paper keys (PK…) must use paper-api, not live api. */
    tradeUrl: (() => {
      const override = env("ALPACA_TRADE_URL", "")!.trim();
      if (override) return override.replace(/\/+$/, "");
      const paperFlag = bool("ALPACA_PAPER", false);
      const keyId = env("ALPACA_API_KEY_ID", "")!.trim();
      const paperKey = paperFlag || /^PK/i.test(keyId);
      return paperKey
        ? "https://paper-api.alpaca.markets"
        : "https://api.alpaca.markets";
    })(),
  },
  kuruEventsUrl: env("DESK_KURU_EVENTS_URL", "http://127.0.0.1:3010/events")!,
  dbPath: env("DESK_DB_PATH", "data/desk.sqlite")!,
};

export function alpacaConfigured(): boolean {
  return Boolean(deskConfig.alpaca.keyId && deskConfig.alpaca.secret);
}
