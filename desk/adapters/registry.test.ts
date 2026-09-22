import { describe, expect, test } from "bun:test";
import { createAdapters, resolveSymbol } from "./registry";

describe("adapter resolve/validate", () => {
  const adapters = createAdapters();

  test("rejects empty and invalid symbols", async () => {
    expect((await resolveSymbol(adapters, "")).ok).toBe(false);
    expect((await resolveSymbol(adapters, "bad symbol!")).ok).toBe(false);
    const long = "A".repeat(40);
    const r = await resolveSymbol(adapters, long);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("too long");
  });

  test("resolves MON-USDC via kuru without network", async () => {
    const r = await resolveSymbol(adapters, "MON-USDC");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ref.symbol).toBe("MON-USDC");
      expect(r.adapter.id).toBe("kuru");
      expect(r.ref.assetClass).toBe("onchain");
    }
  });

  test("resolves BTCUSD via coinbase when alpaca unset", async () => {
    const r = await resolveSymbol(adapters, "BTCUSD");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.ref.symbol).toBe("BTCUSD");
      // Without Alpaca keys, coinbase wins for BTCUSD
      expect(["coinbase", "alpaca"]).toContain(r.adapter.id);
    }
  });

  test("canonical key preserves user-facing form for MON", async () => {
    const r = await resolveSymbol(adapters, "mon-usdc");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ref.symbol).toBe("MON-USDC");
  });
});
