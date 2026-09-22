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
