"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BlockEvent } from "@/lib/types";
import type { BtcState } from "@/lib/useBtc";
import { fmtPrice } from "@/lib/format";
import {
  MACD_MIN_POINTS,
  RSI_MIN_POINTS,
  alignReference,
  buildCandles,
  chooseBucket,
  formatWindow,
  isShortWindow,
  macd,
  mergeImmutableCandles,
  rsi,
  spanMs,
  type Candle,
  type MacdPoint,
  type RefPoint,
  type TimedPrice,
} from "@/lib/series";
import styles from "./desk.module.css";

const BTC_FMT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function useBox<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      const w = Math.max(0, Math.round(r.width));
      const h = Math.max(0, Math.round(r.height));
      setBox((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, box };
}

function padded(vals: number[], frac: number): { lo: number; hi: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of vals) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { lo: 0, hi: 1 };
  const span = hi - lo;
  const pad = span > 0 ? span * frac : Math.max(Math.abs(hi) * 0.001, 1e-6);
  return { lo: lo - pad, hi: hi + pad };
}

function pathOf(pts: Array<{ x: number; y: number }>): string {
  let d = "";
  for (let i = 0; i < pts.length; i++) {
    d += `${i === 0 ? "M" : "L"}${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}`;
  }
  return d;
}

function wordOf(action: string | null | undefined): string {
  if (action === "buy") return "LONG";
  if (action === "sell") return "SHORT";
  if (action === "hold") return "HOLD";
  return "";
}

function CandlePlot({
  candles,
  btcLine,
  latest,
  w,
  h,
}: {
  candles: Candle[];
  btcLine: RefPoint[];
  latest: BlockEvent | null;
  w: number;
  h: number;
}) {
  if (w < 80 || h < 80 || !candles.length) return null;
  const padL = 58;
  const padR = btcLine.length ? 58 : 12;
  const padT = 22;
  const padB = 8;
  const plotW = Math.max(1, w - padL - padR);
  const plotH = Math.max(1, h - padT - padB);
  const t0 = candles[0].t0;
  const t1 = candles[candles.length - 1].t1;
  const span = t1 - t0 || 1;
  const xOf = (t: number) => padL + ((t - t0) / span) * plotW;
  const mon = padded(candles.flatMap((c) => [c.high, c.low]), 0.12);
  const yOf = (p: number) => padT + (1 - (p - mon.lo) / (mon.hi - mon.lo || 1)) * plotH;
  const btc = btcLine.length ? padded(btcLine.map((p) => p.p), 0.08) : null;
  const yBtc = (p: number) =>
    btc ? padT + (1 - (p - btc.lo) / (btc.hi - btc.lo || 1)) * plotH : 0;
  const nominal = Math.max(4, ((candles[0].t1 - candles[0].t0) / span) * plotW);
  const bodyW = Math.max(3, Math.min(14, nominal * 0.68));

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const price = mon.hi - f * (mon.hi - mon.lo);
    const y = padT + f * plotH;
    return { y, price };
  });
  const btcTicks = btc
    ? [0, 0.5, 1].map((f) => ({
        y: padT + f * plotH,
        price: btc.hi - f * (btc.hi - btc.lo),
      }))
    : [];

  const btcPath = pathOf(btcLine.map((p) => ({ x: xOf(p.t), y: yBtc(p.p) })));

  const decision = latest?.decision ?? null;
  const last = candles[candles.length - 1];
  const markerWord = wordOf(decision?.action);
  const markerPct = decision ? Math.round((decision.probabilities[decision.action] ?? 0) * 100) : 0;
  const marker = markerWord
    ? {
        x: xOf(last.t0 + (last.t1 - last.t0) / 2),
        y: yOf(last.close),
        label: `${markerWord} ${markerPct}%`,
        color: decision?.action === "buy" ? "var(--long)" : decision?.action === "sell" ? "var(--short)" : "var(--hold)",
      }
    : null;

  return (
    <svg className={styles.plot} viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label="MON-USDC candles with BTCUSD reference overlay">
      {ticks.map((t) => (
        <g key={t.y}>
          <line x1={padL} x2={padL + plotW} y1={t.y} y2={t.y} stroke="rgba(232,238,248,0.06)" />
          <text className={styles.axis} x={padL - 6} y={t.y + 3} textAnchor="end">
            {fmtPrice(t.price)}
          </text>
        </g>
      ))}
      {btcTicks.map((t) => (
        <text key={`b${t.y}`} className={styles.axisBtc} x={padL + plotW + 6} y={t.y + 3}>
          {BTC_FMT.format(t.price)}
        </text>
      ))}
      {candles.map((c) => {
        const cx = xOf(c.t0 + (c.t1 - c.t0) / 2);
        const up = c.close >= c.open;
        const color = up ? "var(--long)" : "var(--short)";
        const yHigh = yOf(c.high);
        const yLow = yOf(c.low);
        const yOpen = yOf(c.open);
        const yClose = yOf(c.close);
        const top = Math.min(yOpen, yClose);
        const bodyH = Math.max(2, Math.abs(yOpen - yClose));
        return (
          <g key={c.t0}>
            <line x1={cx} x2={cx} y1={yHigh} y2={yLow} stroke={color} strokeWidth="1.2" />
            <rect x={cx - bodyW / 2} y={top} width={bodyW} height={bodyH} fill={color} rx="0.5" />
          </g>
        );
      })}
      {btcPath ? (
        <path d={btcPath} fill="none" stroke="var(--cyan)" strokeWidth="1.4" strokeDasharray="4 3" opacity="0.85" />
      ) : null}
      {marker ? (
        <g>
          <circle cx={marker.x} cy={marker.y} r="3.5" fill={marker.color} />
          <Marker padL={padL} plotW={plotW} marker={marker} />
        </g>
      ) : null}
      <text className={styles.plotLabel} x={padL + 4} y={14}>
        MON-USDC
      </text>
      <text className={styles.plotLabelBtc} x={padL + plotW - 4} y={14} textAnchor="end">
        BTCUSD ref
      </text>
    </svg>
  );
}

function Marker({
  padL,
  plotW,
  marker,
}: {
  padL: number;
  plotW: number;
  marker: { x: number; y: number; label: string; color: string };
}) {
  const bw = Math.max(58, marker.label.length * 6.4 + 12);
  const bx = Math.min(Math.max(marker.x - bw / 2, padL), padL + plotW - bw);
  const by = marker.y < 40 ? marker.y + 8 : marker.y - 22;
  return (
    <g>
      <rect x={bx} y={by} width={bw} height={14} rx="3" fill="rgba(14,19,28,0.92)" stroke={marker.color} />
      <text className={styles.marker} x={bx + bw / 2} y={by + 10} textAnchor="middle" fill={marker.color}>
        {marker.label}
      </text>
    </g>
  );
}

function MacdPlot({
  candles,
  points,
  series,
  w,
  h,
}: {
  candles: Candle[];
  points: TimedPrice[];
  series: MacdPoint[];
  w: number;
  h: number;
}) {
  const ready = series.some((p) => p.hist != null);
  if (w < 80 || h < 36) return null;
  const padL = 58;
  const padR = 12;
  const padT = 16;
  const padB = 6;
  const plotW = Math.max(1, w - padL - padR);
  const plotH = Math.max(1, h - padT - padB);
  if (!ready || !candles.length) {
    return (
      <svg className={styles.plot} viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label="MACD unavailable">
        <text className={styles.paneLabel} x={padL} y={12}>
          MACD
        </text>
        <text className={styles.na} x={w / 2} y={h / 2 + 4} textAnchor="middle">
          {`N/A | need ${MACD_MIN_POINTS} mids, have ${points.length}`}
        </text>
      </svg>
    );
  }
  const t0 = candles[0].t0;
  const t1 = candles[candles.length - 1].t1;
  const span = t1 - t0 || 1;
  const xOf = (t: number) => padL + ((t - t0) / span) * plotW;
  let maxAbs = 0;
  for (const p of series) {
    for (const v of [p.macd, p.signal, p.hist]) {
      if (v != null) maxAbs = Math.max(maxAbs, Math.abs(v));
    }
  }
  if (maxAbs === 0) maxAbs = 1;
  const yOf = (v: number) => padT + (1 - (v + maxAbs) / (2 * maxAbs)) * plotH;
  const zero = yOf(0);
  const macdPts: Array<{ x: number; y: number }> = [];
  const sigPts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < points.length; i++) {
    const pt = series[i];
    if (!pt) continue;
    const x = xOf(points[i].ts);
    if (pt.macd != null) macdPts.push({ x, y: yOf(pt.macd) });
    if (pt.signal != null) sigPts.push({ x, y: yOf(pt.signal) });
  }
  const bars: Array<{ x: number; y: number; h: number; up: boolean; key: number }> = [];
  let j = 0;
  for (const c of candles) {
    let idx = -1;
    while (j < points.length && points[j].ts < c.t1) {
      if (points[j].ts >= c.t0) idx = j;
      j++;
    }
    const hist = idx >= 0 ? series[idx]?.hist : null;
    if (hist == null) continue;
    const y = yOf(hist);
    const top = Math.min(y, zero);
    bars.push({
      x: xOf(c.t0 + (c.t1 - c.t0) / 2),
      y: top,
      h: Math.max(1, Math.abs(y - zero)),
      up: hist >= 0,
      key: c.t0,
    });
  }
  const barW = Math.max(2, Math.min(6, ((candles[0].t1 - candles[0].t0) / span) * plotW * 0.55));
  return (
    <svg className={styles.plot} viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label="MACD">
      <line x1={padL} x2={padL + plotW} y1={zero} y2={zero} stroke="rgba(232,238,248,0.12)" />
      {bars.map((b) => (
        <rect
          key={b.key}
          x={b.x - barW / 2}
          y={b.y}
          width={barW}
          height={b.h}
          fill={b.up ? "var(--long)" : "var(--short)"}
          opacity="0.55"
        />
      ))}
      <path d={pathOf(macdPts)} fill="none" stroke="var(--blue)" strokeWidth="1.3" />
      <path d={pathOf(sigPts)} fill="none" stroke="var(--amber)" strokeWidth="1.3" />
      <text className={styles.paneLabel} x={padL} y={11}>
        MACD
      </text>
      <text className={styles.labBlue} x={padL + plotW} y={11} textAnchor="end">
        macd
      </text>
      <text className={styles.labAmber} x={padL + plotW - 36} y={11} textAnchor="end">
        signal
      </text>
    </svg>
  );
}

function RsiPlot({
  candles,
  points,
  series,
  last,
  w,
  h,
}: {
  candles: Candle[];
  points: TimedPrice[];
  series: Array<number | null>;
  last: number | null;
  w: number;
  h: number;
}) {
  if (w < 80 || h < 36) return null;
  const padL = 58;
  const padR = 12;
  const padT = 16;
  const padB = 6;
  const plotW = Math.max(1, w - padL - padR);
  const plotH = Math.max(1, h - padT - padB);
  const yOf = (v: number) => padT + (1 - v / 100) * plotH;
  if (last == null || !candles.length) {
    return (
      <svg className={styles.plot} viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label="RSI unavailable">
        <text className={styles.paneLabel} x={padL} y={12}>
          RSI(14)
        </text>
        <text className={styles.na} x={w / 2} y={h / 2 + 4} textAnchor="middle">
          {`N/A | need ${RSI_MIN_POINTS} mids, have ${points.length}`}
        </text>
      </svg>
    );
  }
  const t0 = candles[0].t0;
  const t1 = candles[candles.length - 1].t1;
  const span = t1 - t0 || 1;
  const xOf = (t: number) => padL + ((t - t0) / span) * plotW;
  const line: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < points.length; i++) {
    const v = series[i];
    if (v == null) continue;
    line.push({ x: xOf(points[i].ts), y: yOf(v) });
  }
  const bands = [
    { v: 70, color: "rgba(239,68,68,0.35)" },
    { v: 50, color: "rgba(232,238,248,0.1)" },
    { v: 30, color: "rgba(34,197,94,0.35)" },
  ];
  return (
    <svg className={styles.plot} viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img" aria-label="RSI 14">
      <rect x={padL} y={yOf(70)} width={plotW} height={Math.max(0, yOf(30) - yOf(70))} fill="rgba(34,211,238,0.04)" />
      {bands.map((b) => (
        <g key={b.v}>
          <line x1={padL} x2={padL + plotW} y1={yOf(b.v)} y2={yOf(b.v)} stroke={b.color} strokeDasharray="3 2" />
          <text className={styles.axis} x={padL - 6} y={yOf(b.v) + 3} textAnchor="end">
            {b.v}
          </text>
        </g>
      ))}
      <path d={pathOf(line)} fill="none" stroke="var(--violet)" strokeWidth="1.5" />
      <text className={styles.paneLabel} x={padL} y={11}>
        RSI(14)
      </text>
      <text className={styles.labViolet} x={padL + plotW} y={11} textAnchor="end">
        {last.toFixed(1)}
      </text>
    </svg>
  );
}

export default function ChartStack({ events, btc }: { events: BlockEvent[]; btc: BtcState }) {
  const candle = useBox<HTMLDivElement>();
  const macdBox = useBox<HTMLDivElement>();
  const rsiBox = useBox<HTMLDivElement>();
  /** Lock TF once chosen so closed candles are not rebuilt on a new bucket size. */
  const lockedBucketMs = useRef<number | null>(null);
  const frozenCandles = useRef<Candle[]>([]);

  const model = useMemo(() => {
    const points: TimedPrice[] = [];
    for (const e of events) {
      if (Number.isFinite(e.ts) && Number.isFinite(e.mid)) points.push({ ts: e.ts, mid: e.mid });
    }
    const span = spanMs(points);
    const chosen = chooseBucket(span);
    if (lockedBucketMs.current == null && points.length >= 8) {
      lockedBucketMs.current = chosen.bucketMs;
    }
    const bucketMs = lockedBucketMs.current ?? chosen.bucketMs;
    const bucketLabel =
      chosen.bucketMs === bucketMs
        ? chosen.label
        : ({ 1000: "1s", 2000: "2s", 5000: "5s", 10000: "10s", 15000: "15s", 30000: "30s", 60000: "1m" } as Record<
            number,
            string
          >)[bucketMs] ?? `${bucketMs / 1000}s`;
    const rebuilt = buildCandles(points, bucketMs);
    const nowMs = points.length ? points[points.length - 1].ts : Date.now();
    const candles = mergeImmutableCandles(frozenCandles.current, rebuilt, nowMs, bucketMs);
    frozenCandles.current = candles;
    const mids = points.map((p) => p.mid);
    const macdS = macd(mids);
    const rsiS = rsi(mids);
    let lastRsi: number | null = null;
    for (let i = rsiS.length - 1; i >= 0; i--) {
      if (rsiS[i] != null) {
        lastRsi = rsiS[i];
        break;
      }
    }
    const t0 = candles[0]?.t0 ?? 0;
    const t1 = candles[candles.length - 1]?.t1 ?? 0;
    const btcLine = candles.length ? alignReference(btc.prices, t0, t1) : [];
    return {
      points,
      span,
      bucket: { bucketMs, label: bucketLabel },
      candles,
      macdS,
      rsiS,
      lastRsi,
      btcLine,
      short: isShortWindow(span, points.length),
    };
  }, [events, btc.prices]);

  const latest = events.length ? events[events.length - 1] : null;
  const mid = latest && Number.isFinite(latest.mid) ? fmtPrice(latest.mid) : "-";
  const lastBtc = btc.prices.length ? btc.prices[btc.prices.length - 1].p : null;
  const btcLabel =
    btc.status === "loading" ? "..." : lastBtc != null ? `${BTC_FMT.format(lastBtc)} ref` : "N/A";
  const windowLabel =
    model.points.length < 2
      ? "short feed | history not extended"
      : model.short
        ? `window ${formatWindow(model.span)} | short feed`
        : `window ${formatWindow(model.span)}`;
  const refNote = btc.source
    ? `${btc.source}${btc.symbol ? ` ${btc.symbol}` : ""}${btc.interval ? ` ${btc.interval}` : ""} | ref only`
    : btc.status === "down"
      ? "BTCUSD ref N/A"
      : "BTCUSD ref";
  const rsiNote = model.lastRsi != null ? model.lastRsi.toFixed(1) : "N/A";

  return (
    <div className={styles.center}>
      <div className={styles.chartPane}>
        <div className={styles.chartHead}>
          <div className={styles.titleRow}>
            <div className={styles.pt}>
              <span>OHLC | indicators</span>
            </div>
            <span className={styles.windowChip} data-short-window={model.short ? "yes" : "no"}>
              {windowLabel}
            </span>
          </div>
          <div className={styles.chips}>
            <div className={styles.cchip}>
              <span className={styles.lbl}>TF</span>
              <span className={styles.val}>{model.bucket.label}</span>
            </div>
            <div className={styles.cchip}>
              <span className={styles.lbl}>Mid</span>
              <span className={styles.val}>{mid}</span>
            </div>
            <div className={styles.cchip}>
              <span className={styles.lbl}>BTCUSD</span>
              <span className={`${styles.val} ${styles.cyan}`}>{btcLabel}</span>
            </div>
            <div className={styles.paperChip}>PAPER</div>
          </div>
        </div>
        <div className={styles.chartStack}>
          <div className={styles.candleWrap} ref={candle.ref}>
            {model.candles.length ? (
              <CandlePlot
                candles={model.candles}
                btcLine={model.btcLine}
                latest={latest}
                w={candle.box.w}
                h={candle.box.h}
              />
            ) : (
              <div className={styles.empty}>waiting for paper mids</div>
            )}
          </div>
          <div className={styles.macdWrap} ref={macdBox.ref}>
            <MacdPlot
              candles={model.candles}
              points={model.points}
              series={model.macdS}
              w={macdBox.box.w}
              h={macdBox.box.h}
            />
          </div>
          <div className={styles.rsiWrap} ref={rsiBox.ref}>
            <RsiPlot
              candles={model.candles}
              points={model.points}
              series={model.rsiS}
              last={model.lastRsi}
              w={rsiBox.box.w}
              h={rsiBox.box.h}
            />
          </div>
        </div>
        <div className={styles.legend}>
          <span>
            <i className={styles.swBox} style={{ background: "var(--long)" }} />
            <i className={styles.swBox} style={{ background: "var(--short)" }} /> MON-USDC candles
          </span>
          <span>
            <i className={styles.sw} style={{ background: "transparent", borderTop: "1.5px dashed var(--cyan)", height: 0 }} />
            BTCUSD overlay ({refNote})
          </span>
          <span>
            <i className={styles.sw} style={{ background: "var(--blue)" }} /> MACD
            <i className={styles.sw} style={{ background: "var(--amber)", marginLeft: 6 }} /> signal | hist
          </span>
          <span>
            <i className={styles.sw} style={{ background: "var(--violet)" }} /> RSI | last {rsiNote}
          </span>
          <span className={styles.legendNote}>
            {model.candles.length} candles | {model.short ? "short paper window | " : "paper window only | "}
            history not extended
          </span>
        </div>
      </div>
    </div>
  );
}
