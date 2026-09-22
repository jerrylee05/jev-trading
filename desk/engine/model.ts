/**
 * Desk decision models. Paper only. Reuses src/config AI key handling via desk/config.
 */
import { experimental_evaluate, gateway } from "ai";
import { typeSafeAi } from "@ai-sdk/typesafe-ai";
import { deskConfig } from "../config";
import type { DeskFeatures } from "./features";
import { featuresCompact } from "./features";

export type DeskAction = "long" | "short" | "flat";

export interface DeskDecision {
  action: DeskAction;
  probabilities: Record<DeskAction, number>;
  latencyMs: number;
  inputTokens: number;
  costUsd: number;
  model: string;
}

export interface DeskModel {
  readonly name: string;
  decide(features: DeskFeatures, horizonBars: number): Promise<DeskDecision>;
}

const QUESTIONS = {
  direction: {
    type: "choice",
    instructions: {
      question:
        "Over the next `horizonBars` bars on this symbol/TF, is net price change (after spread/slippage cost) more likely up, down, or flat?",
      goal:
        "Paper desk: pick long, short, or flat. Features are compact relative numbers (bps, RSI, MACD hist, EMA stack). The move must beat trading cost.",
      timing: "Decision is held for the scoring horizon; flips need confidence above threshold.",
      inputs:
        "`ret` = close-to-close returns in bps; `emaDist` = close vs EMA in bps; `emaStack` = EMA level order; `rsi14`; `macdHist`/`macdSlope` in bps of price; `atr14Bps`; `volZ20`; `closeInRange` 0..1; `session` flags.",
    },
    criteria: {
      long: "Net of cost, price more likely higher after horizonBars.",
      short: "Net of cost, price more likely lower after horizonBars.",
      flat: "Expected move does not clear cost, or signals conflict / mean-revert to unchanged.",
    },
  },
} as const;

function createJevEvaluationModel() {
  return deskConfig.jevBackend === "gateway"
    ? gateway.evaluationModel(deskConfig.jevEvaluationModelId)
    : typeSafeAi.evaluationModel(deskConfig.jevEvaluationModelId);
}

/** Deterministic stand-in from features (no network). */
export class MockDeskModel implements DeskModel {
  readonly name = "mock";

  async decide(features: DeskFeatures, _horizonBars: number): Promise<DeskDecision> {
    const t0 = performance.now();
    const mom = features.returnsBps.n5 / 12 + features.returnsBps.n20 / 40;
    const trend =
      (features.emaDistBps.ema10 + features.emaDistBps.ema20) / 40 +
      (features.rsi14 - 50) / 25;
    const macd = features.macdHist / 8 + features.macdHistSlope / 4;
    const signal = mom + trend + macd + this.noise(features.barT);
    // Three-way: map signal to long/short/flat
    const longRaw = Math.exp(signal);
    const shortRaw = Math.exp(-signal);
    const flatRaw = Math.exp(1.2 - Math.abs(signal));
    const sum = longRaw + shortRaw + flatRaw;
    const probabilities = {
      long: longRaw / sum,
      short: shortRaw / sum,
      flat: flatRaw / sum,
    };
    let action: DeskAction = "flat";
    if (probabilities.long >= probabilities.short && probabilities.long >= probabilities.flat) {
      action = "long";
    } else if (probabilities.short >= probabilities.long && probabilities.short >= probabilities.flat) {
      action = "short";
    }
    await Bun.sleep(20);
    const latencyMs = performance.now() - t0;
    return {
      action,
      probabilities,
      latencyMs,
      inputTokens: Math.round(JSON.stringify(featuresCompact(features)).length / 4),
      costUsd: 0,
      model: this.name,
    };
  }

  private noise(t: number) {
    let h = (t / 60_000) * 2654435761 >>> 0;
    h ^= h >>> 15;
    h = (h * 2246822519) >>> 0;
    h ^= h >>> 13;
    return ((h % 1000) / 1000 - 0.5) * 1.5;
  }
}

/** Real Jev via AI SDK experimental_evaluate (same pattern as src/model.ts). */
export class JevDeskModel implements DeskModel {
  readonly name = deskConfig.jevEvaluationModelId;
  private model = createJevEvaluationModel();

  async decide(features: DeskFeatures, horizonBars: number): Promise<DeskDecision> {
    const t0 = performance.now();
    const state = {
      ...featuresCompact(features),
      horizonBars,
      costBps: 2, // informational; paper applies slippage separately
    };
    const r = await experimental_evaluate({
      model: this.model,
      state: state as any,
      questions: QUESTIONS,
      maxRetries: 0,
    });
    const a = r.answers.direction;
    const p = a.probabilities ?? { long: 0, short: 0, flat: 0, [a.choice]: 1 };
    const probabilities = {
      long: p.long ?? 0,
      short: p.short ?? 0,
      flat: p.flat ?? 0,
    };
    const action = (a.choice as DeskAction) || "flat";
    const inputTokens = r.usage?.inputTokens ?? 0;
    // Reuse trader's rough token cost if present on root config path — desk keeps 0 when unknown.
    const costUsd = 0;
    return {
      action,
      probabilities,
      latencyMs: performance.now() - t0,
      inputTokens,
      costUsd,
      model: this.name,
    };
  }
}

export function resolveDeskModelName(): "mock" | "jev" {
  const desk = process.env.DESK_MODEL?.trim().toLowerCase();
  if (desk === "mock" || desk === "jev") return desk;
  return deskConfig.model === "jev" ? "jev" : "mock";
}

export function createDeskModel(): DeskModel {
  const name = resolveDeskModelName();
  if (name === "jev") {
    if (!deskConfig.jevBackend) {
      console.warn("[desk] MODEL/DESK_MODEL=jev but no AI key; falling back to mock");
      return new MockDeskModel();
    }
    return new JevDeskModel();
  }
  return new MockDeskModel();
}
