# Bit9 local dry-run

Machine path:

    /Users/bit9/sandbox/repo/mypersonal-github/jev-prj/jev-trading

Fork: [jerrylee05/jev-trading](https://github.com/jerrylee05/jev-trading) (upstream [jarrodwatts/jev-trader](https://github.com/jarrodwatts/jev-trader)).

## Prerequisites

Install [Bun](https://bun.sh) (`bun --version`).

## First-time setup

    cd /Users/bit9/sandbox/repo/mypersonal-github/jev-prj/jev-trading
    bun install
    cp .env.example .env

Defaults in `.env` are safe for paper trading:

- `DRY_RUN=true`
- `PRIVATE_KEY=` (empty)
- `MODEL=mock` (no API key needed)

No wallet key is required. Nothing is signed or sent on chain.

## Start dry-run (mock model)

    bun run start

Expect a startup line containing `DRY RUN` and per-block logs with `(sim)` on quotes.

Quick checks:

    curl -s http://localhost:3000/ | jq '{dryRun, model, wallet, block: .latest.block}'
    curl -N http://localhost:3000/events

Press Ctrl+C to stop.

Optional automated smoke (starts the server, checks `/`, then exits):

    bun run smoke

## Switch to real Jev (still dry-run)

Edit `.env`:

    MODEL=jev
    TYPESAFE_AI_API_KEY=<your typesafe key>
    DRY_RUN=true
    PRIVATE_KEY=

Then `bun run start` again. Model id defaults to `jev-latest` (`JEV_MODEL_ID`).

| Variable | Purpose |
| --- | --- |
| `MODEL` | `mock` (default) or `jev` |
| `TYPESAFE_AI_API_KEY` | TypeSafe API key for `@ai-sdk/typesafe-ai` |
| `JEV_MODEL_ID` | Evaluation model id (default `jev-latest`) |
| `DRY_RUN` | `true` keeps paper mode even if a key is present |
| `PRIVATE_KEY` | Leave empty for paper; required only for live |

Never commit keys. Keep secrets in `.env` only.

### Vercel AI Gateway

This trader calls TypeSafe's evaluation API directly via `@ai-sdk/typesafe-ai`. It reads `TYPESAFE_AI_API_KEY`, not `AI_GATEWAY_API_KEY`. If you use Vercel AI Gateway with `typesafe-ai/jev` in other apps, you still need a TypeSafe key here unless the code is changed to route through Gateway.

## Live trading (not for smoke tests)

Live mode requires **both**:

1. A non-empty `PRIVATE_KEY`
2. `DRY_RUN=false`

Also fund the wallet and Kuru margin (`MARGIN_MON`, `MARGIN_USDC` in `.env.example`). Expect real gas and real orders every block.

The startup banner prints `LIVE` with the wallet address when live mode is active.

## Optional dashboard

The Next.js UI lives in `web/`. Point it at your local backend:

    cd web
    cp .env.example .env.local
    # set NEXT_PUBLIC_API_URL=http://localhost:3000
    bun install
    bun run dev

Backend default port is `3000` (`PORT` in `.env`). Run the web app on another port if both run locally.
