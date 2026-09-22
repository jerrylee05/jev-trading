import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { openDb, getDb, getPosition, listFills, listDecisions } from "../store/db";
import { PaperAccount } from "./paper";
import type { DeskDecision } from "./model";

const PATH = join(import.meta.dir, "..", "..", "data", "desk-paper-test.sqlite");

function dec(partial: Partial<DeskDecision> & { action: DeskDecision["action"] }): DeskDecision {
  const base = { long: 0.2, short: 0.2, flat: 0.6 };
  if (partial.action === "long") Object.assign(base, { long: 0.7, short: 0.15, flat: 0.15 });
  if (partial.action === "short") Object.assign(base, { short: 0.7, long: 0.15, flat: 0.15 });
  return {
    action: partial.action,
    probabilities: partial.probabilities ?? base,
    latencyMs: 10,
    inputTokens: 100,
    costUsd: 0,
    model: "mock",
  };
}

describe("PaperAccount", () => {
  beforeEach(() => {
    rmSync(PATH, { force: true });
    rmSync(PATH + "-wal", { force: true });
    rmSync(PATH + "-shm", { force: true });
    openDb(PATH);
  });
  afterEach(() => {
    try {
      getDb().close();
    } catch {
      /* ignore */
    }
    rmSync(PATH, { force: true });
    rmSync(PATH + "-wal", { force: true });
    rmSync(PATH + "-shm", { force: true });
  });

  test("opens long when p >= flip threshold; respects cooldown", () => {
    const paper = new PaperAccount({
      cashUsd: 100_000,
      notionalUsd: 10_000,
      flipThreshold: 0.6,
      cooldownBars: 2,
      slippageBps: 2,
      commissionUsd: 0,
    });
    const r1 = paper.apply("NVDA", "1m", 1_000, 100, dec({ action: "long" }), "{}");
    expect(r1.skipped).toBeNull();
    expect(r1.fill).not.toBeNull();
    expect(getPosition("NVDA")?.qty).toBeGreaterThan(0);
    expect(listDecisions(10)).toHaveLength(1);
    expect(listFills(10).length).toBeGreaterThanOrEqual(1);

    // Immediate flip blocked by cooldown
    const r2 = paper.apply("NVDA", "1m", 1_060_000, 101, dec({ action: "short" }), "{}");
    expect(r2.skipped?.startsWith("cooldown")).toBe(true);

    paper.tickCooldown("NVDA");
    paper.tickCooldown("NVDA");
    const r3 = paper.apply("NVDA", "1m", 1_120_000, 99, dec({ action: "short" }), "{}");
    expect(r3.skipped).toBeNull();
    expect(getPosition("NVDA")?.qty).toBeLessThan(0);
  });

  test("rejects weak long below flip threshold", () => {
    const paper = new PaperAccount({ flipThreshold: 0.6, cooldownBars: 0 });
    const r = paper.apply(
      "QQQ",
      "1m",
      1,
      400,
      dec({
        action: "long",
        probabilities: { long: 0.55, short: 0.2, flat: 0.25 },
      }),
      "{}",
    );
    expect(r.skipped?.startsWith("below_flip_threshold")).toBe(true);
    expect(getPosition("QQQ")).toBeNull();
  });
});
