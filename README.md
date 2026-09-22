## Desk UI

Phase 0 paper desk: `cd web && bun run dev` (port 3001) against trader on 3010. See `web/README.md`.

# jev-trader

One decision every Monad block. A TypeSafe Jev model watches the Kuru MON-USDC order book and answers buy or sell every ~300 ms. Every block posts a real post-only limit order on that side, one tick inside the touch, replacing the last one. Fills happen when a taker hits it, so the bot earns the spread instead of paying it. A small server streams every block to the dashboard.

## Run

    cp .env.example .env
    bun install
    bun run start

Defaults are paper mode: `DRY_RUN=true`, empty `PRIVATE_KEY`, `MODEL=mock`. Real book and decisions, simulated fills, nothing signed. Live trading needs a non-empty `PRIVATE_KEY` with `DRY_RUN=false`. Set `MODEL=jev` and `AI_GATEWAY_API_KEY` (or `TYPESAFE_AI_API_KEY`) for Jev. Do not set `DRY_RUN=false` unless a wallet is meant to trade. The desk never clears that guard.

Bit9 local setup: see [BIT9.md](./BIT9.md). Quick check: `bun run smoke` (uses a free port; `:3000` may be busy).

## JoCoding Futures Desk

Paper UI in `web/`. It reads the trader JSON and does not take a private key, send orders, or turn dry-run off.

Terminal A, trader on port 3010 (3000 stays free):

    PORT=3010 DRY_RUN=true bun run start

Terminal B, desk on port 3001:

    cd web
    bun install
    bun run dev

Open http://localhost:3001. The page streams `http://127.0.0.1:3010/events` (SSE: `snapshot`, `block`, `quote`, `fill`). `GET http://127.0.0.1:3010/` is the same dry-run snapshot. Override the API with `NEXT_PUBLIC_API_URL` if the trader is not on 3010.

While `dryRun` is true the desk keeps the PAPER badge, the `dryRun=true` pill, and the model pill. Fields the snapshot does not have (score rows, the Noul checklist, a blocked-order counter) stay `N/A`.

## Endpoints

Deployed (dry run, mock model): https://jev-trader-production.up.railway.app

- `GET /` snapshot: model, wallet, dryRun, bankrollUsd, horizonBlocks, latest block event
- `GET /history` last 1000 block events
- `GET /events` SSE: `snapshot` on connect, then one `block` event per block, plus a `fill` event whenever a live order's receipt lands

Each block event includes `levels`: top 5 bids and asks, best first, as `[price, size]`.

Every event (see `src/trader.ts` for types):

    {
      "block": 105488269, "ts": 1789593630676,
      "mid": 0.022636, "bestBid": 0.022628, "bestAsk": 0.022644, "spreadBps": 7.07,
      "decision": { "action": "buy", "probabilities": { "buy": 0.77, "sell": 0.23, "hold": 0 }, "upIn10": 0.77, "latencyMs": 81, "late": false },
      "quote": { "side": "buy", "price": 0.022629, "size": 200, "txHash": "0x…", "gasMon": 0.0357, "cancel": [100295801], "status": "sent", "orderId": null, "capped": false },
      "fill": null,
      "resting": { "bidMon": 200, "askMon": 200 },
      "position": { "side": "short", "size": 200, "entryPrice": 0.022633, "unrealizedUsd": -0.0006, "unrealizedMon": -0.027 },
      "totals": { "blocks": 3, "decisions": 3, "quotes": 3, "fills": 1, "reverted": 0, "lateBlocks": 0, "jevUsd": 0.000004, "gasMon": 0.107, "gasUsd": 0.0024, "realizedUsd": 0, "pnlUsd": -0.003, "pnlMon": -0.13, "pnlPct": -0.003 }
    }

Every block the model is asked about the move over `HORIZON_BLOCKS` (default 100, ~30 s) and answers `buy` or `sell`. `quote` is the order that block put on the book: a post-only limit order of `TRADE_SIZE_MON` on that side, `QUOTE_INSIDE_TICKS` inside the touch (clamped to the touch when the spread is too tight), in one `batchUpdate` that also cancels everything we had resting (`cancel`). `hold` appears only with `decision.late: true`, when the model missed the block and nothing was posted. When the position cap (or, live, margin funds) blocks a side, the quote goes on the other side with `capped: true` and `probabilities` still show the model's call. `resting` is our size known to be on the book after this block. `upIn10` equals the buy probability.

Live sends are fired and forgotten, so the `block` event carries the **intent**: `status: "sent"`, `gasMon` is `gasLimit x (last known base fee + priority)`. Monad charges the gas limit, so that is the real cost whether the order lands or not. The receipt arrives a block or two later as its own SSE event:

    event: quote
    data: { "block": 105488269, "quote": { …, "status": "placed", "orderId": 100295812, "gasMon": 0.0357 } }

`status` becomes `placed` (with the order id) or `reverted` (the book moved through the price before the tx landed, or a cancelled order had already filled). No receipt after 10 blocks gives `lost`. Fills are not in our own transactions: someone else's taker order hits our resting one, and the Trade log for it arrives via the same `eth_getLogs` poll that feeds the model. Each block with fills gets its own SSE event, and `position`, `realizedUsd` and `fills` update then:

    event: fill
    data: { "block": 105488271, "fill": { "side": "buy", "size": 200, "price": 0.022629, "txHash": "0x…", "orderId": 100295812, "simulated": false } }

`txHash` is the taker's transaction. In a dry run the quote is `status: "sim"`: the order rests for one block and a real print crossing its price fills it (`simulated: true`).

## Layout

    src/config.ts   env
    src/chain.ts    block feed (WebSocket newHeads + polling backstop, newest block only), raw RPC
    src/book.ts     one-eth_call order book reader (decodes getL2Book, merges the AMM vault)
    src/market.ts   Kuru: read book, hand-encoded batchUpdate (cancel + post-only place), margin deposits, local nonce, async confirmation
    src/model.ts    Model interface, JevModel (AI SDK experimental_evaluate), MockModel
    src/trader.ts   the loop: one in flight, hold when late, position and P&L accounting
    src/server.ts   Bun.serve: snapshot, history, SSE

## The 300 ms budget

A decision and an order have to fit in one block, so the hot loop makes exactly two RPC round trips:
one `eth_call` for the book (~18 ms on the public RPC, `READ_RPC_URL`) and one `eth_sendRawTransaction`
(`RPC_URL`), which returns as soon as the tx is accepted. Nothing else is on the path — no
`eth_estimateGas` (Monad charges gas on the limit, so the limit is hardcoded or derived once at
startup), no `eth_sendRawTransactionSync` (it blocks until the tx is Proposed), no gas price lookup
(static type-2 fees: `MAX_FEE_GWEI` cap, 2 gwei priority; the effective price is base + priority).
Receipts, the fee estimate and the vault check run off the hot path on later blocks. Measured in a
dry run with the mock model: read p50 18 ms, whole loop p50 100 ms (80 ms of it the mock's inference stand-in).

    bun run scripts/bench-read.ts     # book reader vs the SDK: exactness and latency
    bun run scripts/dry-encode.ts     # signs a buy and a sell offline, asserts the calldata matches the SDK
