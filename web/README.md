# JoCoding Futures Desk

Next.js desk for the dry-run trader. Paper only: it shows Jev's buy/sell call, the book, and simulated position. It does not unlock live trading and it does not read `PRIVATE_KEY`.

## Run with the trader

Trader on port 3010 (leave 3000 free). From the repo root:

```bash
PORT=3010 DRY_RUN=true bun run start
```

Desk on port 3001, from `web/`:

```bash
bun install
bun run dev
```

Open http://localhost:3001. Default API is `http://127.0.0.1:3010` (`GET /` and SSE `/events`). Set `NEXT_PUBLIC_API_URL` to point elsewhere.

`bun run build` then `bun run start` serves the production desk, still on 3001.

## What is on screen

- PAPER badge, `dryRun` pill, and `MODEL` pill whenever the snapshot is a dry run (or the model name contains `jev`).
- Last decision, probabilities, latency, quote, horizon, `upIn10`, late flag.
- Top of book from `levels` when the trader sends it. Otherwise the best bid and ask, with size `N/A`.
- 1 second mid, last 60 seconds, with the latest decision marker and fill marks when those events exist.
- Position, paper PnL, and account equity (`bankrollUsd + pnlUsd`) when the snapshot includes the bankroll.
- Scores and the Noul checklist render as `N/A`. Those fields are not in the trader status.
