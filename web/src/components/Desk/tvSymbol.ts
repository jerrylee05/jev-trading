/**
 * Desk ticker to a TradingView symbol.
 * Known: BTCUSD (Coinbase), NVDA / TSLA / MSTR / QQQ (NASDAQ), SPY (AMEX: NYSE Arca ETF on TV).
 * Unknown on purpose: MON, MON-USDC, and any ticker not listed. Do not guess an exchange.
 */
const TV_SYMBOLS: Record<string, string> = {
  BTCUSD: "COINBASE:BTCUSD",
  NVDA: "NASDAQ:NVDA",
  TSLA: "NASDAQ:TSLA",
  QQQ: "NASDAQ:QQQ",
  SPY: "AMEX:SPY",
  MSTR: "NASDAQ:MSTR",
};

export function toTvSymbol(symbol: string | null | undefined): string | null {
  return TV_SYMBOLS[(symbol ?? "").trim().toUpperCase()] ?? null;
}
