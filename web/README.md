# Jev Trader — web

Next.js (App Router, TypeScript, CSS Modules — no Tailwind) frontend for Jev Trader:
one AI trade decision every Monad block.

## Run

```bash
export BUN_INSTALL_CACHE_DIR="$TMPDIR/bun-cache" BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
bun install
bun run dev      # http://127.0.0.1:3001
bun run build
bun test src/lib/series.test.ts
```

Use Bun only. npm is not the path for this app.

## Config

Copy `.env.example` to `.env.local`. `NEXT_PUBLIC_API_URL` points at the backend.
The paper desk defaults to `http://127.0.0.1:3010` and opens an EventSource on
`$NEXT_PUBLIC_API_URL/events`. Start the trader with `PORT=3010` (see the repo
README). This desk does not unlock live trading and does not read `PRIVATE_KEY`.

## look1-chart

The page is the dark futures desk: last decision, a MON-USDC candle chart,
MACD and RSI under it, and a BTCUSD reference line on its own axis.

- Candles, MACD(12,26,9) and RSI(14) are computed in the browser from paper
  mids already on the feed (`src/lib/series.ts`). No older history is invented.
- The trader keeps about 1000 blocks (roughly 5 minutes at 300 ms). The chart
  labels the real bucket (often 10s, not 1m) and the observed window. A window
  under 90s is marked `short feed`.
- MACD needs 34 mids and RSI needs 15. Fewer than that, the pane says N/A.
- BTCUSD is a public reference only (`/api/btcusd`, Coinbase trades, with
  Binance 1s and Coinbase 1m candles as fallbacks). It is not an input to the
  MON order. If the reference is down, the chip says N/A.
- Book size, account equity, horizon, scores, and the noul checklist are not
  in the paper JSON. Those cells stay N/A.
- PAPER, dryRun, and MODEL stay on the banner. The live dot does not blink.

## Layout

- `src/lib/types.ts`: wire types (`BlockEvent`, `Decision`, `Fill`, `Meta`)
- `src/lib/useFeed.ts`: SSE hook (snapshot, block, fill, ping), 1000-event
  window, 1s to 10s reconnect backoff, `connection` state, `avgLatencyMs`
- `src/lib/series.ts`: candles, MACD, RSI, BTC alignment
- `src/lib/useBtc.ts`: polls `/api/btcusd`
- `src/lib/useUptime.ts`: `useUptime(startedAt)` to ticking `"hh:mm:ss"`
- `src/lib/format.ts`: number, address, and tx formatting
- `src/components/Desk/`: look1-chart desk
- `src/app/globals.css`: page background
- `src/components/<Name>/<Name>.tsx`: earlier desk components (not mounted)
