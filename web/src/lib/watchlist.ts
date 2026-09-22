/** ASCII dash. Rendered desk copy does not use em dashes or middle dots. */
export const WATCH_UNAVAIL = "-";

export function fmtLast(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return WATCH_UNAVAIL;
  const digits = Math.abs(n) >= 1 ? 2 : 4;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** `pct` is already a percent (1.25 means +1.25%). */
export function fmtChgPct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return WATCH_UNAVAIL;
  if (pct === 0) return "0.00%";
  const sign = pct > 0 ? "+" : "-";
  return `${sign}${Math.abs(pct).toFixed(2)}%`;
}

export function chgTone(pct: number | null | undefined): "up" | "dn" | "flat" {
  if (pct == null || !Number.isFinite(pct) || pct === 0) return "flat";
  return pct > 0 ? "up" : "dn";
}
