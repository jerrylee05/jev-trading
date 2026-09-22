import { describe, expect, test } from "bun:test";
import { BarAggregator, floorTime } from "./aggregator";

describe("BarAggregator immutability", () => {
  test("closed bars do not rewrite when later ticks arrive", () => {
    const a = new BarAggregator();
    const closed: Array<{ t: number; o: number; h: number; l: number; c: number }> = [];
    a.onBar((_sym, tf, bar, live) => {
      if (!live && tf === "1s") closed.push({ t: bar.t, o: bar.o, h: bar.h, l: bar.l, c: bar.c });
    });

    const t0 = floorTime(1_700_000_000_000, "1s");
    a.onTick("NVDA", { t: t0 + 100, price: 100, size: 1 });
    a.onTick("NVDA", { t: t0 + 400, price: 110, size: 1 });
    a.onTick("NVDA", { t: t0 + 1_100, price: 105, size: 1 });

    expect(closed.length).toBe(1);
    expect(closed[0]).toEqual({ t: t0, o: 100, h: 110, l: 100, c: 110 });

    const frozen = a.getClosed("NVDA", "1s", t0);
    expect(frozen).toEqual({ t: t0, o: 100, h: 110, l: 100, c: 110, v: 2, n: 2, src: "tick" });

    a.onTick("NVDA", { t: t0 + 1_500, price: 99, size: 1 });
    expect(a.getClosed("NVDA", "1s", t0)).toEqual(frozen);

    const live = a.getLive("NVDA", "1s");
    expect(live?.t).toBe(t0 + 1_000);
    expect(a.listClosed("NVDA", "1s").filter((b) => b.t === live!.t).length).toBe(0);
  });

  test("provider 1m closed bars are write-once", () => {
    const a = new BarAggregator();
    const t = floorTime(Date.now(), "1m");
    a.ingestProviderBar("NVDA", "1m", { t, o: 1, h: 2, l: 1, c: 1.5, v: 10, n: 3, src: "alpaca" }, false);
    a.ingestProviderBar("NVDA", "1m", { t, o: 9, h: 9, l: 9, c: 9, v: 99, n: 99, src: "alpaca" }, false);
    expect(a.getClosed("NVDA", "1m", t)).toEqual({
      t,
      o: 1,
      h: 2,
      l: 1,
      c: 1.5,
      v: 10,
      n: 3,
      src: "alpaca",
    });
  });

  test("exactly one live bar per TF", () => {
    const a = new BarAggregator();
    const t0 = floorTime(Date.now(), "5s");
    a.onTick("QQQ", { t: t0 + 10, price: 400 });
    a.onTick("QQQ", { t: t0 + 20, price: 401 });
    expect(a.getLive("QQQ", "5s")?.t).toBe(t0);
    a.onTick("QQQ", { t: t0 + 5_010, price: 402 });
    expect(a.getLive("QQQ", "5s")?.t).toBe(t0 + 5_000);
    expect(a.getClosed("QQQ", "5s", t0)?.c).toBe(401);
  });
});
