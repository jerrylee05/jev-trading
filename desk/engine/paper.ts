/**
 * Paper account: notional flips with slippage/commission. Never places live orders.
 */
import { deskConfig } from "../config";
import type { DeskAction, DeskDecision } from "./model";
import {
  insertFill,
  insertDecision,
  upsertPosition,
  getPosition,
  getCashLedger,
  setCashLedger,
  type DecisionRow,
  type FillRow,
  type PositionRow,
} from "../store/db";

export interface PaperApplyResult {
  decision: DecisionRow;
  fill: FillRow | null;
  position: PositionRow | null;
  skipped: string | null;
  cashUsd: number;
}

export interface PaperAccountOpts {
  cashUsd?: number;
  notionalUsd?: number;
  slippageBps?: number;
  commissionUsd?: number;
  flipThreshold?: number;
  cooldownBars?: number;
  horizonBars?: number;
}

function id(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class PaperAccount {
  cashUsd: number;
  notionalUsd: number;
  slippageBps: number;
  commissionUsd: number;
  flipThreshold: number;
  cooldownBars: number;
  horizonBars: number;
  /** symbol -> bars since last fill */
  private cooldownLeft = new Map<string, number>();
  /** symbol -> last decided bar open time */
  private lastDecisionBar = new Map<string, number>();

  constructor(opts: PaperAccountOpts = {}) {
    this.cashUsd = opts.cashUsd ?? deskConfig.paperCashUsd;
    this.notionalUsd = opts.notionalUsd ?? deskConfig.notionalUsd;
    this.slippageBps = opts.slippageBps ?? deskConfig.slippageBps;
    this.commissionUsd = opts.commissionUsd ?? deskConfig.commissionUsd;
    this.flipThreshold = opts.flipThreshold ?? deskConfig.flipThreshold;
    this.cooldownBars = opts.cooldownBars ?? deskConfig.cooldownBars;
    this.horizonBars = opts.horizonBars ?? deskConfig.horizonBars;
    // Restore cash from ledger if present
    const led = getCashLedger();
    if (led != null) this.cashUsd = led;
    else setCashLedger(this.cashUsd);
  }

  /** Call once per closed decision bar per symbol (after apply). */
  tickCooldown(symbol: string) {
    const left = this.cooldownLeft.get(symbol) ?? 0;
    if (left > 0) this.cooldownLeft.set(symbol, left - 1);
  }

  apply(
    symbol: string,
    tf: string,
    barT: number,
    price: number,
    decision: DeskDecision,
    featuresJson: string,
  ): PaperApplyResult {
    const pAction = decision.probabilities[decision.action] ?? 0;
    const decisionRow: DecisionRow = {
      id: id("dec"),
      symbol,
      t: barT,
      tf,
      action: decision.action,
      p_long: decision.probabilities.long,
      p_short: decision.probabilities.short,
      p_flat: decision.probabilities.flat,
      latency_ms: decision.latencyMs,
      input_tokens: decision.inputTokens,
      cost_usd: decision.costUsd,
      features: featuresJson,
      horizon_bars: this.horizonBars,
      scored_at: null,
      outcome: null,
    };
    insertDecision(decisionRow);
    this.lastDecisionBar.set(symbol, barT);

    const pos = getPosition(symbol);
    const curSide: DeskAction =
      !pos || pos.qty === 0 ? "flat" : pos.qty > 0 ? "long" : "short";
    const target = decision.action;

    let skipped: string | null = null;
    if (target === curSide) {
      skipped = "already_in_position";
      return { decision: decisionRow, fill: null, position: pos, skipped, cashUsd: this.cashUsd };
    }
    if (pAction < this.flipThreshold && target !== "flat") {
      // Opening or flipping into long/short requires confidence; flattening always allowed if cooldown ok
      skipped = `below_flip_threshold:${pAction.toFixed(3)}<${this.flipThreshold}`;
      return { decision: decisionRow, fill: null, position: pos, skipped, cashUsd: this.cashUsd };
    }
    const cd = this.cooldownLeft.get(symbol) ?? 0;
    if (cd > 0) {
      skipped = `cooldown:${cd}`;
      return { decision: decisionRow, fill: null, position: pos, skipped, cashUsd: this.cashUsd };
    }

    const fill = this.executeFlip(symbol, curSide, target, price, decisionRow.id);
    this.cooldownLeft.set(symbol, this.cooldownBars);
    const nextPos = getPosition(symbol);
    setCashLedger(this.cashUsd);
    return {
      decision: decisionRow,
      fill,
      position: nextPos,
      skipped: null,
      cashUsd: this.cashUsd,
    };
  }

  private executeFlip(
    symbol: string,
    from: DeskAction,
    to: DeskAction,
    mid: number,
    decisionId: string,
  ): FillRow {
    const now = Date.now();
    const slip = this.slippageBps / 10_000;
    let qty = 0;
    let side = "buy";
    let price = mid;

    // Close existing
    const cur = getPosition(symbol);
    let realized = cur?.realized_usd ?? 0;
    if (cur && cur.qty !== 0) {
      const closeSide = cur.qty > 0 ? "sell" : "buy";
      const closePx = cur.qty > 0 ? mid * (1 - slip) : mid * (1 + slip);
      const pnl = cur.qty * (closePx - cur.avg_price);
      realized += pnl;
      this.cashUsd += cur.qty * closePx;
      this.cashUsd -= this.commissionUsd;
      const closeFill: FillRow = {
        id: id("fill"),
        symbol,
        t: now,
        side: closeSide,
        qty: Math.abs(cur.qty),
        price: closePx,
        slippage_bps: this.slippageBps,
        commission_usd: this.commissionUsd,
        decision_id: decisionId,
      };
      insertFill(closeFill);
      upsertPosition({
        symbol,
        qty: 0,
        avg_price: 0,
        realized_usd: realized,
        updated_at: now,
      });
      if (to === "flat") return closeFill;
    }

    if (to === "flat") {
      // already flat
      return {
        id: id("fill"),
        symbol,
        t: now,
        side: "flat",
        qty: 0,
        price: mid,
        slippage_bps: 0,
        commission_usd: 0,
        decision_id: decisionId,
      };
    }

    // Open new
    const notional = Math.min(this.notionalUsd, Math.max(0, this.cashUsd * 0.95));
    qty = notional / mid;
    if (to === "long") {
      side = "buy";
      price = mid * (1 + slip);
      this.cashUsd -= qty * price + this.commissionUsd;
    } else {
      side = "sell";
      price = mid * (1 - slip);
      // short: credit proceeds
      this.cashUsd += qty * price - this.commissionUsd;
      qty = -qty;
    }
    const fill: FillRow = {
      id: id("fill"),
      symbol,
      t: now,
      side,
      qty: Math.abs(qty),
      price,
      slippage_bps: this.slippageBps,
      commission_usd: this.commissionUsd,
      decision_id: decisionId,
    };
    insertFill(fill);
    upsertPosition({
      symbol,
      qty,
      avg_price: price,
      realized_usd: realized,
      updated_at: now,
    });
    return fill;
  }

  snapshot() {
    return {
      cashUsd: this.cashUsd,
      notionalUsd: this.notionalUsd,
      flipThreshold: this.flipThreshold,
      cooldownBars: this.cooldownBars,
      horizonBars: this.horizonBars,
      slippageBps: this.slippageBps,
      commissionUsd: this.commissionUsd,
    };
  }
}
