import { fmtInt, fmtPrice } from "./format";
import type { BlockEvent, ConnectionState, Decision, Meta, Position } from "./types";

/** Strings the desk renders that are not derived from the feed. */
export const COPY = {
  kicker: "JoCoding Futures Desk | Jev decision layer",
  title: "JEV Decision",
  pair: "MON-USDC / Kuru",
  lastDecision: "Last decision",
  choiceTick: "Choice | tick",
  confidence: "confidence",
  latency: "latency",
  liveBook: "Live book",
  paper: "paper",
  bids: "Bids",
  asks: "Asks",
  chart: "1s mid | last 60s",
  blocks: "Blocks",
  decisions: "Decisions",
  blockedLate: "Blocked / late",
  position: "Position",
  size: "Size",
  entry: "Entry",
  notional: "Notional",
  unrealized: "Unrealized",
  resting: "Resting bid/ask",
  scores: "Scores",
  parallel: "parallel",
  momentum: "Momentum",
  retrace: "Retrace risk",
  bookPressure: "Book pressure",
  checklist: "Noul checklist",
  gate: "gate",
  sellPressure: "Sell pressure rising",
  spreadTradable: "Spread tradable",
  breakout: "Breakout confirmed",
  allowSize: "Allow size",
  gateway: "Gateway",
  block: "Block",
  paperPnl: "Paper PnL",
  account: "Account",
  quoteSide: "Quote side",
  horizon: "Horizon",
  upIn10: "upIn10",
  late: "Late?",
  long: "LONG",
  short: "SHORT",
  hold: "HOLD",
  unlock: "never live until Jerry unlock",
  na: "N/A",
  /** Shown when scores or checklist fields are not on the feed yet. */
  awaitingFeed: "awaiting feed fields",
} as const;

const NA = COPY.na;
/** Unavailable scalar; ASCII dash (desk forbids em/en dashes in rendered copy). */
const UNAVAIL = "-";
const WINDOW_MS = 60_000;
const SPARK_W = 400;
const SPARK_H = 72;

export type Tone = "long" | "short" | "hold" | "flat" | "empty";
export type MoneyTone = "up" | "dn" | "flat";

export interface BookRow {
  price: string;
  size: string;
  empty: boolean;
}

export interface SparkMarker {
  x: number;
  y: number;
  label: string;
  tone: "long" | "short";
}

export interface SparkFill {
  x: number;
  y: number;
  tone: "long" | "short";
}

export interface SparkModel {
  line: string | null;
  area: string | null;
  tone: "long" | "short" | "hold";
  marker: SparkMarker | null;
  fills: SparkFill[];
  /** Horizontal entry line, in viewBox y, when the entry price sits in the window. */
  entryY: number | null;
}

export interface DeskModel {
  stripe: "PAPER" | "LIVE";
  banner: string;
  dryRunPill: string;
  modelPill: string;
  modelIsJev: boolean;
  dot: "live" | "wait";
  gateway: string;
  block: string;
  paperPnl: { text: string; tone: MoneyTone };
  account: string;
  action: string;
  actionTone: Tone;
  confidence: string;
  latency: string;
  bars: { name: string; tone: "long" | "short" | "hold"; width: number; label: string }[];
  quote: { text: string; tone: Tone };
  horizon: string;
  upIn10: string;
  late: { text: string; tone: MoneyTone };
  bookSub: string;
  mid: string;
  spread: string;
  touch: string;
  bids: BookRow[];
  asks: BookRow[];
  spark: SparkModel;
  stats: { blocks: string; decisions: string; fills: string; fillsLabel: string; fillsAmber: boolean; blockedLate: string };
  positionSide: string;
  positionTone: "long" | "short" | "flat";
  size: string;
  entry: string;
  notional: string;
  unrealized: { text: string; tone: MoneyTone };
  resting: string;
  footerApi: string;
  connection: ConnectionState;
}

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** Probabilities are 0..1. Values above 1 are treated as already-percent figures. */
export function unitProb(n: unknown): number | null {
  if (!finite(n)) return null;
  const u = n > 1 ? n / 100 : n;
  if (u < 0) return 0;
  if (u > 1) return 1;
  return u;
}

export function fmtMoney(n: number | null, digits: number): string {
  if (n == null || !Number.isFinite(n)) return NA;
  const abs = Math.abs(n);
  const body = abs.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${n < 0 ? "-" : ""}$${body}`;
}

function moneyDigits(n: number): number {
  const abs = Math.abs(n);
  return abs !== 0 && abs < 1 ? 4 : 2;
}

function moneyTone(n: number | null): MoneyTone {
  if (n == null || !Number.isFinite(n) || n === 0) return "flat";
  return n < 0 ? "dn" : "up";
}

function hostOf(apiUrl: string): string {
  try {
    return new URL(apiUrl).host;
  } catch {
    return apiUrl.replace(/^https?:\/\//, "");
  }
}

function qty(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  if (Number.isInteger(rounded)) return fmtInt(rounded);
  return rounded.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Real ladder levels only; no padded N/A rows. Top of book alone is one row per side. */
function bookRows(levels: number[][] | undefined, best: number | undefined): BookRow[] {
  const rows: BookRow[] = [];
  if (levels?.length) {
    for (const lvl of levels) {
      if (!lvl || !finite(lvl[0])) continue;
      rows.push({
        price: fmtPrice(lvl[0]),
        size: finite(lvl[1]) ? qty(lvl[1]) : NA,
        empty: false,
      });
    }
    return rows;
  }
  if (finite(best)) rows.push({ price: fmtPrice(best), size: NA, empty: false });
  return rows;
}

/** Gateway model id -> short pill label (typesafe-ai/jev -> jev). */
export function shortModelLabel(model: string): string {
  const trimmed = model.trim();
  const lower = trimmed.toLowerCase();
  if (lower === "typesafe-ai/jev" || lower.endsWith("/jev")) return "jev";
  return trimmed;
}

function blockedLateLabel(lateBlocks: number | undefined): string {
  if (!finite(lateBlocks)) return `${UNAVAIL} / ${UNAVAIL}`;
  return `${UNAVAIL} / ${fmtInt(lateBlocks)}`;
}

function actionOf(decision: Decision | null | undefined): { word: string; tone: Tone } {
  const a = decision?.action;
  if (a === "buy") return { word: COPY.long, tone: "long" };
  if (a === "sell") return { word: COPY.short, tone: "short" };
  if (a === "hold") return { word: COPY.hold, tone: "hold" };
  return { word: NA, tone: "empty" };
}

function confidenceOf(decision: Decision | null | undefined): string {
  if (!decision) return NA;
  const key = decision.action;
  const u = unitProb(decision.probabilities?.[key]);
  if (u == null) return NA;
  return `${(u * 100).toFixed(1)}%`;
}

function bar(name: string, tone: "long" | "short" | "hold", raw: unknown) {
  const u = unitProb(raw);
  if (u == null) return { name, tone, width: 0, label: NA };
  return { name, tone, width: Math.round(u * 100), label: `${Math.round(u * 100)}%` };
}

function quoteLabel(latest: BlockEvent | null): { text: string; tone: Tone } {
  const q = latest?.quote;
  if (!q) return { text: NA, tone: "flat" };
  const sim = q.status === "sim" ? " sim" : q.status === "sent" ? " sent" : q.status === "reverted" ? " reverted" : q.status === "lost" ? " lost" : "";
  const cap = q.capped ? " cap" : "";
  const tone: Tone = q.side === "buy" ? "long" : "short";
  return { text: `${q.side}${sim}${cap}`, tone };
}

function horizonLabel(blocks: number | undefined): string {
  if (!finite(blocks) || blocks <= 0) return NA;
  const sec = Math.round(blocks * 0.3);
  return `${fmtInt(blocks)} blk (${fmtInt(sec)}s)`;
}

function notional(pos: Position | undefined, mid: number | undefined): number | null {
  if (!pos || !finite(pos.size)) return null;
  if (pos.size === 0) return 0;
  const px = finite(pos.entryPrice) ? pos.entryPrice : finite(mid) ? mid : null;
  if (px == null) return null;
  return pos.size * px;
}

interface SparkPoint { t: number; mid: number; x: number; y: number }

function n(v: number): string {
  return v.toFixed(2);
}

export function buildSpark(events: BlockEvent[], position: Position | null | undefined): SparkModel {
  const empty: SparkModel = { line: null, area: null, tone: "hold", marker: null, fills: [], entryY: null };
  const stamped = events.filter((e) => finite(e.ts) && finite(e.mid));
  if (!stamped.length) return empty;
  const end = stamped.reduce((m, e) => (e.ts > m ? e.ts : m), stamped[0]!.ts);
  const start = end - WINDOW_MS;
  const bySec = new Map<number, { t: number; mid: number }>();
  for (const e of stamped) {
    if (e.ts < start || e.ts > end) continue;
    bySec.set(Math.floor(e.ts / 1000), { t: e.ts, mid: e.mid });
  }
  const raw = [...bySec.values()].sort((a, b) => a.t - b.t);
  if (!raw.length) return empty;

  let lo = Infinity;
  let hi = -Infinity;
  for (const p of raw) {
    if (p.mid < lo) lo = p.mid;
    if (p.mid > hi) hi = p.mid;
  }
  const span = hi - lo;
  if (!(span > 0)) {
    const pad = Math.abs(lo) * 0.0002 || 1e-6;
    lo -= pad;
    hi += pad;
  } else {
    lo -= span * 0.14;
    hi += span * 0.14;
  }
  const yOf = (mid: number) => 10 + (1 - (mid - lo) / (hi - lo)) * 52;
  const xOf = (t: number) => Math.min(SPARK_W, Math.max(0, ((t - start) / WINDOW_MS) * SPARK_W));
  const points: SparkPoint[] = raw.map((p) => ({ t: p.t, mid: p.mid, x: xOf(p.t), y: yOf(p.mid) }));

  let line: string | null = null;
  let area: string | null = null;
  if (points.length >= 2) {
    line = points.map((p, i) => `${i === 0 ? "M" : "L"}${n(p.x)},${n(p.y)}`).join(" ");
    const last = points[points.length - 1]!;
    const first = points[0]!;
    area = `${line} L${n(last.x)},${SPARK_H} L${n(first.x)},${SPARK_H} Z`;
  }

  const nearest = (t: number): SparkPoint => {
    let best = points[0]!;
    let dist = Infinity;
    for (const p of points) {
      const d = Math.abs(p.t - t);
      if (d < dist) {
        dist = d;
        best = p;
      }
    }
    return best;
  };

  let decided: BlockEvent | null = null;
  for (const e of stamped) {
    if (e.ts < start || e.ts > end) continue;
    const a = e.decision?.action;
    if (!e.decision || e.decision.late) continue;
    if (a === "buy" || a === "sell") decided = e;
  }

  let marker: SparkMarker | null = null;
  if (decided?.decision) {
    const pt = nearest(decided.ts);
    const sell = decided.decision.action === "sell";
    const u = unitProb(decided.decision.probabilities?.[decided.decision.action]);
    const pct = u == null ? NA : `${Math.round(u * 100)}%`;
    marker = {
      x: pt.x,
      y: pt.y,
      label: `${sell ? "▼" : "▲"} ${sell ? COPY.short : COPY.long} ${pct}`,
      tone: sell ? "short" : "long",
    };
  }

  const fills: SparkFill[] = [];
  const seen = new Set<number>();
  for (const e of stamped) {
    if (!e.fill || e.ts < start || e.ts > end) continue;
    const sec = Math.floor(e.ts / 1000);
    if (seen.has(sec)) continue;
    seen.add(sec);
    const pt = nearest(e.ts);
    fills.push({ x: pt.x, y: pt.y, tone: e.fill.side === "buy" ? "long" : "short" });
    if (fills.length >= 20) break;
  }

  let entryY: number | null = null;
  const entry = position?.entryPrice;
  if (finite(entry) && entry >= lo && entry <= hi) entryY = yOf(entry);

  const tone: SparkModel["tone"] = decided?.decision?.action === "sell" ? "short" : decided?.decision?.action === "buy" ? "long" : "hold";
  return { line, area, tone, marker, fills, entryY };
}

const SCORE_ROWS = [
  { label: COPY.momentum },
  { label: COPY.retrace },
  { label: COPY.bookPressure },
] as const;

const CHECK_ROWS = [COPY.sellPressure, COPY.spreadTradable, COPY.breakout, COPY.allowSize] as const;

/** Scores and the Noul checklist are not fields on the trader snapshot. */
export const UNMAPPED_SCORES = SCORE_ROWS.map((row) => ({ label: row.label, value: NA }));
export const UNMAPPED_CHECKS = CHECK_ROWS.map((label) => ({ label, answer: NA }));

export function scoresHaveFeed(): boolean {
  return UNMAPPED_SCORES.some((row) => row.value !== NA);
}

export function checklistHasFeed(): boolean {
  return UNMAPPED_CHECKS.some((row) => row.answer !== NA);
}

export function buildDesk(meta: Meta | null, latest: BlockEvent | null, events: BlockEvent[], connection: ConnectionState, apiUrl: string): DeskModel {
  const paper = meta == null || meta.dryRun !== false;
  const model = meta?.model?.trim() ?? "";
  const modelIsJev = model.toLowerCase().includes("jev");
  const host = hostOf(apiUrl);
  const decision = latest?.decision ?? null;
  const action = actionOf(decision);
  const probs = decision?.probabilities;
  const pnl = latest ? latest.totals?.pnlUsd : null;
  const pnlN = finite(pnl) ? pnl : null;
  const equity = meta && finite(meta.bankrollUsd) && pnlN != null ? meta.bankrollUsd + pnlN : null;
  const unreal = latest ? latest.position?.unrealizedUsd : null;
  const unrealN = finite(unreal) ? unreal : null;
  const pos = latest?.position;
  const side = pos?.side;
  const positionTone: "long" | "short" | "flat" = side === "long" ? "long" : side === "short" ? "short" : "flat";
  const notion = notional(pos, latest?.mid);

  return {
    stripe: paper ? "PAPER" : "LIVE",
    banner: paper
      ? `DRY-RUN | simulated fills | no live money | ${host} overlay`
      : `LIVE WALLET | read only | this desk does not send orders | ${host}`,
    dryRunPill: meta ? `dryRun=${meta.dryRun ? "true" : "false"}` : "dryRun=N/A",
    modelPill: model ? `MODEL=${shortModelLabel(model)}` : "MODEL=N/A",
    modelIsJev,
    dot: connection === "live" ? "live" : "wait",
    gateway: decision && finite(decision.latencyMs) ? `${Math.round(decision.latencyMs)} ms` : NA,
    block: latest && finite(latest.block) ? `#${fmtInt(latest.block)}` : NA,
    paperPnl: { text: pnlN == null ? NA : fmtMoney(pnlN, moneyDigits(pnlN)), tone: moneyTone(pnlN) },
    account: equity == null ? UNAVAIL : fmtMoney(equity, 2),
    action: action.word,
    actionTone: action.tone,
    confidence: confidenceOf(decision),
    latency: decision && finite(decision.latencyMs) ? `${Math.round(decision.latencyMs)}ms` : NA,
    bars: [
      bar(COPY.long, "long", probs?.buy),
      bar(COPY.short, "short", probs?.sell),
      bar(COPY.hold, "hold", probs?.hold),
    ],
    quote: quoteLabel(latest),
    horizon: horizonLabel(meta?.horizonBlocks),
    upIn10: decision && finite(decision.upIn10) ? decision.upIn10.toFixed(3) : NA,
    late: decision ? { text: decision.late ? "true" : "false", tone: decision.late ? "dn" : "up" } : { text: NA, tone: "flat" },
    bookSub: paper ? COPY.paper : "wallet",
    mid: latest && finite(latest.mid) ? fmtPrice(latest.mid) : NA,
    spread: latest && finite(latest.spreadBps) ? `spread ${latest.spreadBps.toFixed(2)} bps` : "spread N/A",
    touch: `bid ${latest && finite(latest.bestBid) ? fmtPrice(latest.bestBid) : NA} / ask ${latest && finite(latest.bestAsk) ? fmtPrice(latest.bestAsk) : NA}`,
    bids: bookRows(latest?.levels?.bids, latest?.bestBid),
    asks: bookRows(latest?.levels?.asks, latest?.bestAsk),
    spark: buildSpark(events.length ? events : latest ? [latest] : [], pos),
    stats: {
      blocks: latest ? fmtInt(latest.totals?.blocks) : NA,
      decisions: latest ? fmtInt(latest.totals?.decisions) : NA,
      fills: latest ? fmtInt(latest.totals?.fills) : NA,
      fillsLabel: paper ? "Fills (sim)" : "Fills",
      fillsAmber: paper,
      blockedLate: latest ? blockedLateLabel(latest.totals?.lateBlocks) : `${UNAVAIL} / ${UNAVAIL}`,
    },
    positionSide: side === "long" ? COPY.long : side === "short" ? COPY.short : side === "flat" ? "FLAT" : NA,
    positionTone,
    size: pos && finite(pos.size) ? `${qty(pos.size)} MON` : NA,
    entry: pos && finite(pos.entryPrice) ? fmtPrice(pos.entryPrice) : NA,
    notional: fmtMoney(notion, notion != null && Math.abs(notion) !== 0 && Math.abs(notion) < 1 ? 4 : 2),
    unrealized: { text: unrealN == null ? NA : fmtMoney(unrealN, moneyDigits(unrealN)), tone: moneyTone(unrealN) },
    resting: latest?.resting ? `${qty(latest.resting.bidMon)} / ${qty(latest.resting.askMon)}` : NA,
    footerApi: apiUrl,
    connection,
  };
}
