/**
 * Watchlist LAST / CHG% from stored bars.
 * LAST is the live print when one exists, otherwise the newest closed 1m close.
 * CHG% is that last versus the prior session close (US/Eastern day for equities,
 * UTC day for crypto). Missing reference price leaves CHG% empty.
 */

export interface QuoteBar {
  t: number;
  c: number;
}

export interface WatchQuote {
  symbol: string;
  last: number | null;
  prev: number | null;
  chgPct: number | null;
  /** Bar open time of `last`, so the client can ignore older prints. */
  asOf: number | null;
}

function finite(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Midnight at the start of the calendar day containing `now`, in `timeZone`. */
export function dayStartMs(now: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    dtf
      .formatToParts(new Date(now))
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  let hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  if (hour === 24) hour = 0;
  const nowSec = Math.floor(now / 1000) * 1000;
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset = asUtc - nowSec;
  return Date.UTC(year, month - 1, day, 0, 0, 0) - offset;
}

/** Session boundary used as the previous-close cutoff for this print. */
export function sessionAnchorMs(t: number, assetClass: string): number {
  const tz = assetClass === "crypto" ? "UTC" : "America/New_York";
  return dayStartMs(t, tz);
}

export function pctChange(last: number | null, prev: number | null): number | null {
  if (last == null || prev == null) return null;
  if (!Number.isFinite(last) || !Number.isFinite(prev) || prev === 0) return null;
  return ((last - prev) / prev) * 100;
}

export function assembleQuote(args: {
  symbol: string;
  live: QuoteBar | null;
  latest: QuoteBar | null;
  prevClose: number | null;
}): WatchQuote {
  const last = finite(args.live?.c ?? args.latest?.c ?? null);
  const asOf = finite(args.live?.t ?? args.latest?.t ?? null);
  const prev = finite(args.prevClose);
  return {
    symbol: args.symbol,
    last,
    prev,
    chgPct: pctChange(last, prev),
    asOf,
  };
}

/** Prefer the live bar whose open time is newest (1s tick over a stale 1m bucket). */
export function pickLiveBar(lives: Array<QuoteBar | null | undefined>): QuoteBar | null {
  let best: QuoteBar | null = null;
  for (const bar of lives) {
    if (!bar || !Number.isFinite(bar.c) || !Number.isFinite(bar.t)) continue;
    if (!best || bar.t >= best.t) best = { t: bar.t, c: bar.c };
  }
  return best;
}
