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

Port `3000` is often taken on Bit9 (for example the jev-triage Next.js app). Pick another port:

    PORT=3010 bun run start

Expect a startup line containing `DRY RUN` and per-block logs with `(sim)` on quotes.

Quick checks (use the same `PORT` you started with):

    curl -s http://localhost:3010/ | jq '{dryRun, model, wallet, block: .latest.block}'
    curl -N http://localhost:3010/events

Press Ctrl+C to stop.

Optional automated smoke (picks a free high port such as 3010+, checks trader JSON, then exits):

    bun run smoke

Smoke ignores `.env` `PORT` unless you pass `PORT=<n> bun run smoke`. It asserts `Content-Type: application/json` and `dryRun: true` so it does not confuse another app on `:3000` with the trader.

## Switch to real Jev (still dry-run)

Bun loads `.env` automatically. It does **not** load `.env.local`; this repo reads `.env.local` at startup (vars already set in the shell win). On Bit9, copy keys into `.env.local` or export them; never commit secrets.

### Option A: Vercel AI Gateway (Bit9 default)

If you already have `AI_GATEWAY_API_KEY` in `.env.local`:

    MODEL=jev
    AI_GATEWAY_API_KEY=<your gateway key>
    DRY_RUN=true
    PRIVATE_KEY=

Model id defaults to `typesafe-ai/jev` (`JEV_GATEWAY_MODEL_ID`). Then `bun run start` again.

### Option B: Direct TypeSafe API

    MODEL=jev
    TYPESAFE_AI_API_KEY=<your typesafe key>
    DRY_RUN=true
    PRIVATE_KEY=

Model id defaults to `jev-latest` (`JEV_MODEL_ID`).

| Variable | Purpose |
| --- | --- |
| `MODEL` | `mock` (default) or `jev` |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway key; preferred when set |
| `JEV_GATEWAY_MODEL_ID` | Gateway evaluation model (default `typesafe-ai/jev`) |
| `TYPESAFE_AI_API_KEY` | TypeSafe API key for `@ai-sdk/typesafe-ai` |
| `JEV_MODEL_ID` | TypeSafe evaluation model id (default `jev-latest`) |
| `DRY_RUN` | `true` keeps paper mode even if a key is present |
| `PRIVATE_KEY` | Leave empty for paper; required only for live |

Never commit keys. Keep secrets in `.env` or `.env.local` only.

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

Default backend port is `3000` (`PORT` in `.env`), but on Bit9 you will usually set `PORT=3010` (or another free port) because `:3000` is already in use. Point the web app at whatever port the trader uses, for example `NEXT_PUBLIC_API_URL=http://localhost:3010`.
