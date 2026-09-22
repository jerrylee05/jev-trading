# Jev Desk (paper)

Phase 0 single-symbol paper shell for `jev-trading`.

## Layout

- Top bar: title **Jev Desk (paper)**, PAPER badge, dryRun / model pills, last / spread
- Main: decision strip + lightweight-charts v5 stack (candles/bars, EMA 10/20/50/200, MACD, RSI)
- Right rail (320px): empty Watchlist (Phase 3) over Symbol detail
- Status bar: feed, dryRun, model, latency, uptime, api, live locked

## Honest data

- Candles come only from trader mid prints (SSE). Late blocks omit `mid` and are skipped by the series builder.
- Scores / Noul / Book N/A panels are removed. No invented fields.
- BTCUSD is an optional public reference overlay (off by default), never part of the MON trade path.

## TV reference chart

The chart toolbar switches **Desk (LWC)** and **TV ref**. Desk (LWC) stays the default. TV ref loads TradingView's hosted advanced-chart embed for the selected symbol and unmounts the Lightweight Charts canvas. Switching back destroys the embed container.

OpenStock is not vendored. That project is AGPL-3.0, and none of its source is copied here. The reference chart is only the TradingView embed script (`embed-widget-advanced-chart.js`) plus a small symbol map: BTCUSD to `COINBASE:BTCUSD`, NVDA / TSLA / QQQ / MSTR to NASDAQ, SPY to `AMEX:SPY`. Unmapped tickers such as MON-USDC show a note instead of a guessed exchange. No Finnhub and no Mongo.

On Bit9, soft-pull this branch (fetch and check it out; do not merge):

```bash
cd web && bun install && bun run dev
```

Open http://127.0.0.1:3001. In the chart toolbar, next to the BTC overlay control, click **TV ref**. Pick a watchlist symbol. The embed follows that selection. **Desk (LWC)** returns to the desk chart.

## Run

```bash
# terminal 1 — trader (paper)
PORT=3010 DRY_RUN=true bun run start

# terminal 2 — desk
cd web && bun install && bun run dev
# open http://127.0.0.1:3001
```

`NEXT_PUBLIC_API_URL` defaults to `http://127.0.0.1:3010`.

## Test / build

```bash
bun test
cd web && bun run build
```

Phase 0 only. No Phase 1+.
