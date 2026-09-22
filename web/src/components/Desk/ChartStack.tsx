"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BarSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { eventMids } from "@/lib/eventMids";
import {
  MACD_MIN_POINTS,
  RSI_MIN_POINTS,
  alignReference,
  buildCandles,
  chooseBucket,
  ema,
  isShortWindow,
  macd,
  mergeImmutableCandles,
  rsi,
  spanMs,
  type Candle,
} from "@/lib/series";
import type { BlockEvent } from "@/lib/types";
import type { BtcFeed } from "@/lib/useBtc";
import styles from "./Desk.module.css";

/** Jerry lock: primary TF strip (1M = calendar-approx month). */
const TF_OPTIONS = [
  { label: "1m", ms: 60_000 },
  { label: "10m", ms: 600_000 },
  { label: "30m", ms: 1_800_000 },
  { label: "1h", ms: 3_600_000 },
  { label: "1d", ms: 86_400_000 },
  { label: "1w", ms: 604_800_000 },
  { label: "1M", ms: 2_592_000_000 },
] as const;

/** Default visible bar count — packed session density (TradingView-like), not fitContent. */
const PACKED_VISIBLE_BARS = 320;

function packedVisibleBars(_bucketMs: number): number {
  // Same packed default for 1m and peer TFs; clamp later to available length.
  return PACKED_VISIBLE_BARS;
}

const EMA_PERIODS = [10, 20, 50, 200] as const;
const EMA_COLORS = ["#f5c542", "#ff9800", "#2962ff", "#e040fb"] as const;

type BarStyle = "candles" | "bars";

export interface ChartStackProps {
  events: BlockEvent[];
  /** When this changes (selected symbol), force setData instead of update. */
  seriesKey?: string;
  /** Selected ticker for price-series title / meta (not the BTC overlay). */
  symbol?: string | null;
  btc: BtcFeed;
  btcOn: boolean;
  onToggleBtc: () => void;
  /** Desk (LWC) vs TV ref. Rendered beside the BTC overlay control. */
  sourceToggle?: ReactNode;
}

function toTime(ms: number): UTCTimestamp {
  const n = typeof ms === "number" ? ms : Number(ms);
  const msN = Number.isFinite(n) ? (n < 1_000_000_000_000 ? n * 1000 : n) : Date.now();
  return Math.floor(msN / 1000) as UTCTimestamp;
}

export default function ChartStack(props: ChartStackProps) {
  const { events, seriesKey = "default", symbol = null, btc, btcOn, onToggleBtc, sourceToggle = null } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceRef = useRef<ISeriesApi<"Candlestick"> | ISeriesApi<"Bar"> | null>(null);
  const emaRefs = useRef<Array<ISeriesApi<"Line"> | null>>([null, null, null, null]);
  const macdRef = useRef<ISeriesApi<"Line"> | null>(null);
  const signalRef = useRef<ISeriesApi<"Line"> | null>(null);
  const histRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const rsiRef = useRef<ISeriesApi<"Line"> | null>(null);
  const btcRef = useRef<ISeriesApi<"Line"> | null>(null);
  const frozenRef = useRef<Candle[]>([]);
  const lockedBucketRef = useRef<number | null>(null);
  const dataKeyRef = useRef("");
  const lastOhlcLenRef = useRef(0);
  const scaleLockedRef = useRef(false);
  const btcKeyRef = useRef("");

  const [barStyle, setBarStyle] = useState<BarStyle>("candles");
  const [tfMs, setTfMs] = useState<number | null>(60_000);
  const [showEma, setShowEma] = useState(true);
  const [showMacd, setShowMacd] = useState(true);
  const [showRsi, setShowRsi] = useState(true);

  // Symbol / series change must drop frozen candles + auto-TF lock; otherwise a
  // prior feed (e.g. MON mids) merges into BTC history and sticky scale blanks the pane.
  const seriesGuardRef = useRef(seriesKey);
  if (seriesGuardRef.current !== seriesKey) {
    seriesGuardRef.current = seriesKey;
    frozenRef.current = [];
    lockedBucketRef.current = null;
    dataKeyRef.current = "";
    lastOhlcLenRef.current = 0;
    scaleLockedRef.current = false;
    btcKeyRef.current = "";
  }

  const points = useMemo(() => eventMids(events), [events]);
  const span = spanMs(points);
  const short = isShortWindow(span, points.length);
  const auto = chooseBucket(span);
  const bucketMs = tfMs ?? lockedBucketRef.current ?? auto.bucketMs;
  const bucketLabel = TF_OPTIONS.find((t) => t.ms === bucketMs)?.label ?? auto.label;

  // Relock auto-TF when history backfill arrives (2 live ticks must not freeze 1s).
  const prevPtsRef = useRef(0);
  if (points.length > prevPtsRef.current + 5) {
    lockedBucketRef.current = null;
  }
  prevPtsRef.current = points.length;
  if (lockedBucketRef.current == null && points.length >= 2) {
    lockedBucketRef.current = auto.bucketMs;
  }

  const nowMs = points.length ? points[points.length - 1]!.ts : Date.now();
  const rebuilt = buildCandles(points, bucketMs);
  const candles = mergeImmutableCandles(frozenRef.current, rebuilt, nowMs, bucketMs);
  frozenRef.current = candles;

  const closes = candles.map((c) => c.close);
  const closeKey = closes.join(",");
  const emaSeries = useMemo(() => EMA_PERIODS.map((p) => ema(closes, p)), [closeKey]);
  const macdSeries = useMemo(() => macd(closes), [closeKey]);
  const rsiSeries = useMemo(() => rsi(closes), [closeKey]);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#131722" },
        textColor: "#d1d4dc",
        fontFamily: "IBM Plex Mono, ui-monospace, monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { color: "#2a2e39" }, horzLines: { color: "#2a2e39" } },
      // autoScale on at create; locked after first setData so ticks do not re-fit Y
      rightPriceScale: { borderColor: "#2a2e39", autoScale: true },
      timeScale: { borderColor: "#2a2e39", timeVisible: true, secondsVisible: true },
      crosshair: { mode: 0 },
    });
    chart.addPane(true);
    chart.addPane(true);
    const panes = chart.panes();
    panes[0]?.setStretchFactor(0.62);
    panes[1]?.setStretchFactor(0.2);
    panes[2]?.setStretchFactor(0.18);

    priceRef.current = chart.addSeries(
      CandlestickSeries,
      {
        upColor: "#26a69a",
        downColor: "#ef5350",
        borderUpColor: "#26a69a",
        borderDownColor: "#ef5350",
        wickUpColor: "#26a69a",
        wickDownColor: "#ef5350",
        title: symbol ?? seriesKey,
        lastValueVisible: true,
      },
      0,
    );

    EMA_PERIODS.forEach((period, i) => {
      emaRefs.current[i] = chart.addSeries(
        LineSeries,
        {
          color: EMA_COLORS[i],
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          title: `EMA ${period}`,
        },
        0,
      );
    });

    macdRef.current = chart.addSeries(
      LineSeries,
      { color: "#2962ff", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "MACD" },
      1,
    );
    signalRef.current = chart.addSeries(
      LineSeries,
      { color: "#ff6d00", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, title: "Signal" },
      1,
    );
    histRef.current = chart.addSeries(
      HistogramSeries,
      { priceLineVisible: false, lastValueVisible: false, title: "Hist" },
      1,
    );

    const rsiLine = chart.addSeries(
      LineSeries,
      { color: "#7e57c2", lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: "RSI" },
      2,
    );
    rsiLine.createPriceLine({ price: 70, color: "#787b86", lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
    rsiLine.createPriceLine({ price: 50, color: "#2a2e39", lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
    rsiLine.createPriceLine({ price: 30, color: "#787b86", lineWidth: 1, lineStyle: 2, axisLabelVisible: false });
    rsiRef.current = rsiLine;

    btcRef.current = chart.addSeries(
      LineSeries,
      {
        color: "#787b86",
        lineWidth: 1,
        lineStyle: 2,
        priceScaleId: "btc",
        priceLineVisible: false,
        lastValueVisible: true,
        title: "BTC ref",
        visible: false,
      },
      0,
    );
    chart.priceScale("btc").applyOptions({ borderVisible: false });
    chartRef.current = chart;
    return () => {
      scaleLockedRef.current = false;
      btcKeyRef.current = "";
      chart.remove();
      chartRef.current = null;
      priceRef.current = null;
      emaRefs.current = [null, null, null, null];
      macdRef.current = null;
      signalRef.current = null;
      histRef.current = null;
      rsiRef.current = null;
      btcRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const prev = priceRef.current;
    if (prev) chart.removeSeries(prev);
    priceRef.current =
      barStyle === "candles"
        ? chart.addSeries(
            CandlestickSeries,
            {
              upColor: "#26a69a",
              downColor: "#ef5350",
              borderUpColor: "#26a69a",
              borderDownColor: "#ef5350",
              wickUpColor: "#26a69a",
              wickDownColor: "#ef5350",
            },
            0,
          )
        : chart.addSeries(BarSeries, { upColor: "#26a69a", downColor: "#ef5350", thinBars: false }, 0);
    dataKeyRef.current = "";
  }, [barStyle]);

  useEffect(() => {
    for (const s of emaRefs.current) s?.applyOptions({ visible: showEma });
  }, [showEma]);
  useEffect(() => {
    macdRef.current?.applyOptions({ visible: showMacd });
    signalRef.current?.applyOptions({ visible: showMacd });
    histRef.current?.applyOptions({ visible: showMacd });
    chartRef.current?.panes()[1]?.setStretchFactor(showMacd ? 0.2 : 0.02);
  }, [showMacd]);
  useEffect(() => {
    rsiRef.current?.applyOptions({ visible: showRsi });
    chartRef.current?.panes()[2]?.setStretchFactor(showRsi ? 0.18 : 0.02);
  }, [showRsi]);
  useEffect(() => {
    btcRef.current?.applyOptions({ visible: btcOn });
  }, [btcOn]);

  useEffect(() => {
    const title = symbol ?? seriesKey;
    priceRef.current?.applyOptions({ title });
  }, [symbol, seriesKey, barStyle]);

  useEffect(() => {
    try {
    const price = priceRef.current;
    if (!price) return;
    const key = `${seriesKey}:${bucketMs}:${barStyle}`;
    const ohlc = candles
      .filter((c) => Number.isFinite(c.t0) && Number.isFinite(c.open) && Number.isFinite(c.close))
      .map((c) => ({
        time: Number(toTime(c.t0)) as UTCTimestamp,
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
      }));
    // Empty first paint must not commit dataKey — otherwise the later bars-only
    // update path paints a single candle and sticky scale locks to a blank pane.
    if (!ohlc.length) {
      if (dataKeyRef.current !== key) {
        dataKeyRef.current = "";
        lastOhlcLenRef.current = 0;
        frozenRef.current = [];
        scaleLockedRef.current = false;
        btcKeyRef.current = "";
        try {
          price.setData([]);
        } catch {
          /* ignore */
        }
      }
      return;
    }
    // Live tick can arrive before history backfill; jumping from 1 -> N bars
    // must setData the full series (update-only would leave a blank sticky pane).
    const historyJump = ohlc.length > lastOhlcLenRef.current + 1;
    const reset = dataKeyRef.current !== key || historyJump;
    dataKeyRef.current = key;
    lastOhlcLenRef.current = ohlc.length;
    if (reset) {
      frozenRef.current = [];
      scaleLockedRef.current = false;
      btcKeyRef.current = "";
    }
    try {
      if (reset) price.setData(ohlc);
      else price.update(ohlc[ohlc.length - 1]!);
    } catch (err) {
      // Recover from LWC time-order glitches without blanking the desk shell.
      console.warn("[ChartStack] price set/update failed; resetting series", err);
      try {
        price.setData(ohlc);
      } catch (err2) {
        console.warn("[ChartStack] price reset failed", err2);
      }
    }

    for (let i = 0; i < EMA_PERIODS.length; i++) {
      const series = emaRefs.current[i];
      if (!series) continue;
      const data = candles.flatMap((c, idx) => {
        const v = emaSeries[i]![idx];
        return v == null ? [] : [{ time: toTime(c.t0), value: v }];
      });
      if (reset) series.setData(data);
      else if (data.length) series.update(data[data.length - 1]!);
    }

    if (macdRef.current && signalRef.current && histRef.current) {
      if (closes.length >= MACD_MIN_POINTS) {
        const macdData: { time: UTCTimestamp; value: number }[] = [];
        const signalData: { time: UTCTimestamp; value: number }[] = [];
        const histData: { time: UTCTimestamp; value: number; color: string }[] = [];
        for (let i = 0; i < candles.length; i++) {
          const m = macdSeries[i];
          if (!m || m.macd == null) continue;
          const t = toTime(candles[i]!.t0);
          macdData.push({ time: t, value: m.macd });
          if (m.signal != null) signalData.push({ time: t, value: m.signal });
          if (m.hist != null) {
            histData.push({
              time: t,
              value: m.hist,
              color: m.hist >= 0 ? "rgba(38,166,154,0.55)" : "rgba(239,83,80,0.55)",
            });
          }
        }
        if (reset) {
          macdRef.current.setData(macdData);
          signalRef.current.setData(signalData);
          histRef.current.setData(histData);
        } else {
          if (macdData.length) macdRef.current.update(macdData[macdData.length - 1]!);
          if (signalData.length) signalRef.current.update(signalData[signalData.length - 1]!);
          if (histData.length) histRef.current.update(histData[histData.length - 1]!);
        }
      } else if (reset) {
        macdRef.current.setData([]);
        signalRef.current.setData([]);
        histRef.current.setData([]);
      }
    }

    if (rsiRef.current) {
      if (closes.length >= RSI_MIN_POINTS) {
        const data = candles.flatMap((c, i) => {
          const v = rsiSeries[i];
          return v == null ? [] : [{ time: toTime(c.t0), value: v }];
        });
        if (reset) rsiRef.current.setData(data);
        else if (data.length) rsiRef.current.update(data[data.length - 1]!);
      } else if (reset) {
        rsiRef.current.setData([]);
      }
    }

    if (btcRef.current && btcOn) {
      const t0 = candles[0]?.t0 ?? nowMs - 60_000;
      const t1 = candles[candles.length - 1]?.t1 ?? nowMs;
      const aligned = alignReference(
        btc.points.map((p) => ({ t: p.t, p: p.p })),
        t0,
        t1,
      );
      const btcData = aligned.map((p) => ({ time: toTime(p.t), value: p.p }));
      const btcKey = `${bucketMs}:btc:${btcOn}`;
      const btcReset = reset || btcKeyRef.current !== btcKey;
      btcKeyRef.current = btcKey;
      if (btcReset) btcRef.current.setData(btcData);
      else if (btcData.length) btcRef.current.update(btcData[btcData.length - 1]!);
    }

    const chart = chartRef.current;
    // Packed default window on TF/style/symbol reset (or first paint) — NOT
    // fitContent across the whole bar store (that yields sparse/gappy 1m).
    // Keep autoScale ON so Y still fits the visible candles.
    if (chart && ohlc.length && (reset || !scaleLockedRef.current)) {
      chart.priceScale("right").applyOptions({ autoScale: true });
      try {
        chart.priceScale("btc").applyOptions({ autoScale: true });
      } catch {
        /* overlay scale may not exist yet */
      }
      const n = Math.min(ohlc.length, packedVisibleBars(bucketMs));
      const from = Math.max(0, ohlc.length - n) - 0.5;
      const to = ohlc.length - 1 + 0.5;
      try {
        chart.timeScale().setVisibleLogicalRange({ from, to });
      } catch {
        chart.timeScale().fitContent();
      }
      // Avoid hairline candles when the pane is wide vs packed bar count.
      try {
        chart.timeScale().applyOptions({ minBarSpacing: 4, barSpacing: 6 });
      } catch {
        /* older LWC */
      }
      scaleLockedRef.current = true;
    }
    } catch (err) {
      console.warn("[ChartStack] data effect failed", err);
    }
  }, [candles, emaSeries, macdSeries, rsiSeries, closes.length, bucketMs, barStyle, btc, btcOn, nowMs, seriesKey]);

  function pickTf(ms: number) {
    setTfMs(ms);
    lockedBucketRef.current = ms;
    frozenRef.current = [];
    dataKeyRef.current = "";
    lastOhlcLenRef.current = 0;
    scaleLockedRef.current = false;
    btcKeyRef.current = "";
  }

  const last = candles[candles.length - 1];
  const prevBar = candles.length > 1 ? candles[candles.length - 2] : null;
  const chg = last && prevBar && prevBar.close ? ((last.close - prevBar.close) / prevBar.close) * 100 : null;

  return (
    <div className={styles.chartStack}>
      <div className={styles.chartToolbar}>
        {sourceToggle}
        <div className={styles.tfGroup} role="group" aria-label="Timeframe">
          {TF_OPTIONS.map((t) => (
            <button
              key={t.ms}
              type="button"
              className={t.ms === bucketMs ? styles.tfActive : styles.tfBtn}
              onClick={() => pickTf(t.ms)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className={styles.tfGroup} role="group" aria-label="Style">
          <button
            type="button"
            className={barStyle === "candles" ? styles.tfActive : styles.tfBtn}
            onClick={() => setBarStyle("candles")}
          >
            Candles
          </button>
          <button
            type="button"
            className={barStyle === "bars" ? styles.tfActive : styles.tfBtn}
            onClick={() => setBarStyle("bars")}
          >
            Bars
          </button>
        </div>
        <button type="button" className={showEma ? styles.toolActive : styles.toolBtn} onClick={() => setShowEma((v) => !v)}>
          EMA
        </button>
        <button type="button" className={showMacd ? styles.toolActive : styles.toolBtn} onClick={() => setShowMacd((v) => !v)}>
          MACD
        </button>
        <button type="button" className={showRsi ? styles.toolActive : styles.toolBtn} onClick={() => setShowRsi((v) => !v)}>
          RSI
        </button>
        <button type="button" className={btcOn ? styles.toolActive : styles.toolBtn} onClick={onToggleBtc}>
          BTC ref
        </button>
        <span className={styles.chartMeta}>
          {symbol ?? seriesKey} · {bucketLabel}
          {short ? " · short window" : ""}
          {btcOn ? " · BTC ref overlay" : ""}
        </span>
        {last ? (
          <span className={styles.chartOhlc}>
            O {last.open.toFixed(6)} H {last.high.toFixed(6)} L {last.low.toFixed(6)} C {last.close.toFixed(6)}
            {chg != null ? (
              <span className={chg >= 0 ? styles.up : styles.dn}>
                {" "}
                {chg >= 0 ? "+" : ""}
                {chg.toFixed(2)}%
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
      <div className={styles.chartBody}>
        <div className={styles.chartHost} ref={hostRef} />
        {!candles.length ? (
          <div className={styles.chartEmpty}>Waiting for paper mids from the trader feed.</div>
        ) : null}
      </div>
    </div>
  );
}
