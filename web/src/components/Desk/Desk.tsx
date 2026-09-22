"use client";

import { FormEvent, useMemo, useState } from "react";
import ChartStack from "./ChartStack";
import { COPY, buildDesk } from "@/lib/deskView";
import type { FeedState } from "@/lib/types";
import { useBtc } from "@/lib/useBtc";
import {
  decisionForSymbol,
  deskDecisionToUi,
  feedHint,
  positionForSymbol,
  useDesk,
} from "@/lib/useDesk";
import { useUptime } from "@/lib/useUptime";
import styles from "./Desk.module.css";

function moneyClass(tone: "up" | "dn" | "flat" | undefined): string {
  if (tone === "up") return styles.up;
  if (tone === "dn") return styles.dn;
  return styles.flat;
}

function actionClass(tone: string): string {
  if (tone === "long") return styles.actionLong;
  if (tone === "short") return styles.actionShort;
  if (tone === "hold") return styles.actionHold;
  return styles.actionEmpty;
}

function fmtCarried(ms: number | null): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `carried ${(ms / 1000).toFixed(1)}s`;
  if (ms < 60_000) return `carried ${(ms / 1000).toFixed(1)}s`;
  return `carried ${(ms / 60_000).toFixed(1)}m`;
}

export default function Desk({
  feed,
  apiUrl,
  deskUrl,
}: {
  feed: FeedState;
  apiUrl: string;
  deskUrl: string;
}) {
  const [btcOn, setBtcOn] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const btc = useBtc(btcOn);
  const desk = useDesk(deskUrl);
  const view = useMemo(
    () => buildDesk(feed.meta, feed.latest, feed.events, feed.connection, apiUrl),
    [feed.meta, feed.latest, feed.events, feed.connection, apiUrl],
  );
  const uptime = useUptime(feed.meta?.startedAt);
  const paper = true;
  const selected = desk.symbols.find((s) => s.symbol === desk.selected);
  const deskDec = decisionForSymbol(desk.decisions, desk.selected);
  const deskUi = deskDecisionToUi(deskDec);
  const deskPos = positionForSymbol(desk.positions, desk.selected);
  const hint = feedHint(selected, desk.status, desk.bars.length + (desk.live ? 1 : 0));
  const chartEvents = desk.connection === "live" || desk.symbols.length ? desk.events : feed.events;
  const usingDesk = desk.connection === "live" || desk.events.length > 0;
  const deskLast = desk.live?.c ?? (desk.bars.length ? desk.bars[desk.bars.length - 1]!.c : null);
  const deskQuoteMid =
    usingDesk && deskLast != null && Number.isFinite(deskLast)
      ? deskLast.toLocaleString(undefined, { maximumFractionDigits: 6 })
      : null;
  const deskDetail = (() => {
    if (!usingDesk) return null;
    const qty = deskPos?.qty ?? 0;
    const entry = deskPos?.avg_price ?? null;
    const mark = deskLast;
    const side = qty > 0 ? "LONG" : qty < 0 ? "SHORT" : "FLAT";
    const tone = qty > 0 ? "long" : qty < 0 ? "short" : undefined;
    const size =
      Math.abs(qty) > 0 ? Math.abs(qty).toLocaleString(undefined, { maximumFractionDigits: 6 }) : "—";
    const entryText =
      entry != null && Number.isFinite(entry)
        ? entry.toLocaleString(undefined, { maximumFractionDigits: 6 })
        : "—";
    const notional =
      entry != null && Math.abs(qty) > 0
        ? (Math.abs(qty) * entry).toLocaleString(undefined, { maximumFractionDigits: 2 })
        : "—";
    let unrealizedText = "—";
    let unrealizedTone: "up" | "dn" | "flat" | undefined;
    if (entry != null && mark != null && Math.abs(qty) > 0) {
      const u = (mark - entry) * qty;
      unrealizedTone = u > 0 ? "up" : u < 0 ? "dn" : "flat";
      unrealizedText = u.toLocaleString(undefined, { maximumFractionDigits: 4, signDisplay: "exceptZero" });
    }
    const realized = deskPos?.realized_usd;
    let paperText = "—";
    let paperTone: "up" | "dn" | "flat" | undefined;
    if (realized != null && Number.isFinite(realized)) {
      paperTone = realized > 0 ? "up" : realized < 0 ? "dn" : "flat";
      paperText = realized.toLocaleString(undefined, { maximumFractionDigits: 4, signDisplay: "exceptZero" });
    }
    return {
      side,
      tone,
      size,
      entryText,
      notional,
      unrealizedText,
      unrealizedTone,
      paperText,
      paperTone,
    };
  })();
  // One decision card for selected symbol only. Quiet when unresolved / no bars
  // or when that symbol has no desk decision (no MON orphan probs).
  const deskQty = deskPos?.qty ?? 0;
  const hasDeskDec = Boolean(deskDec);
  const deskQuiet =
    usingDesk &&
    ((desk.bars.length + (desk.live ? 1 : 0)) === 0 || !hasDeskDec);
  // COMMIT 13413da: action ↔ owned desk position (never MON, never contradicting card).
  // Probs + latency come only from this symbol's desk decision (below).
  const showAction = !usingDesk
    ? view.late.text === "true" && view.carriedAction
      ? view.carriedAction
      : view.action
    : deskQuiet
      ? "—"
      : deskQty > 0
        ? "LONG"
        : deskQty < 0
          ? "SHORT"
          : "FLAT";
  const showTone = !usingDesk
    ? view.late.text === "true" && view.carriedAction
      ? "hold"
      : view.actionTone
    : deskQuiet
      ? "empty"
      : deskQty > 0
        ? "long"
        : deskQty < 0
          ? "short"
          : "hold";
  const carried = usingDesk
    ? deskQuiet
      ? null
      : deskDec
        ? fmtCarried(Date.now() - deskDec.t)
        : null
    : fmtCarried(view.carriedAgeMs);
  const stripConfidence = usingDesk
    ? deskQuiet
      ? "—"
      : deskDec
        ? `${(Math.max(deskDec.p_long, deskDec.p_short, deskDec.p_flat) * 100).toFixed(1)}%`
        : "—"
    : view.confidence;
  const stripLatency = usingDesk
    ? deskQuiet
      ? "—"
      : deskDec
        ? `${Math.round(deskDec.latency_ms)}ms`
        : "—"
    : view.latency;
  const stripBlock = usingDesk ? "—" : view.block;
  const stripUpIn10 = usingDesk
    ? deskQuiet
      ? "—"
      : deskDec
        ? deskDec.p_long.toFixed(3)
        : "—"
    : view.upIn10;
  const stripBars = usingDesk
    ? deskQuiet || !deskDec
      ? [
          { name: "LONG", width: 0, label: "—", tone: "long" as const },
          { name: "SHORT", width: 0, label: "—", tone: "short" as const },
          { name: "FLAT", width: 0, label: "—", tone: "hold" as const },
        ]
      : [
          {
            name: "LONG",
            width: Math.round(deskDec.p_long * 100),
            label: `${(deskDec.p_long * 100).toFixed(0)}%`,
            tone: "long" as const,
          },
          {
            name: "SHORT",
            width: Math.round(deskDec.p_short * 100),
            label: `${(deskDec.p_short * 100).toFixed(0)}%`,
            tone: "short" as const,
          },
          {
            name: "FLAT",
            width: Math.round(deskDec.p_flat * 100),
            label: `${(deskDec.p_flat * 100).toFixed(0)}%`,
            tone: "hold" as const,
          },
        ]
    : view.bars;

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormErr(null);
    const res = await desk.addSymbol(draft);
    setBusy(false);
    if (!res.ok) {
      setFormErr(res.error);
      return;
    }
    setDraft("");
  }

  async function onRemove(symbol: string) {
    setBusy(true);
    setFormErr(null);
    const res = await desk.removeSymbol(symbol);
    setBusy(false);
    if (!res.ok) setFormErr(res.error);
  }

  const deskModelRaw = (desk.status?.modelName || desk.status?.model || "mock").trim();
  const deskModelShort = /jev/i.test(deskModelRaw)
    ? deskModelRaw.toLowerCase().includes("jev") && !deskModelRaw.toLowerCase().startsWith("mock")
      ? deskModelRaw.replace(/^typesafe-ai\//i, "").slice(0, 24)
      : "jev"
    : deskModelRaw.toLowerCase().startsWith("mock") || deskModelRaw === ""
      ? "mock"
      : deskModelRaw.slice(0, 24);
  const modelPill = usingDesk ? `MODEL=${deskModelShort}` : view.modelPill;
  const modelIsJev = usingDesk ? /jev/i.test(deskModelRaw) && !/^mock$/i.test(deskModelRaw) : view.modelIsJev;

  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <div className={styles.brand}>
          <span className={styles.title}>{COPY.title}</span>
          <span className={paper ? styles.paperPill : styles.livePill}>{view.stripe}</span>
          <span className={styles.pair}>{desk.selected ?? "MULTI"}</span>
        </div>
        <div className={styles.quoteStrip}>
          <span className={styles.last}>{usingDesk ? (deskQuoteMid ?? "—") : view.mid}</span>
          <span className={styles.muted}>{usingDesk ? "—" : view.spread}</span>
          <span className={styles.muted}>{usingDesk ? "—" : view.touch}</span>
        </div>
        <div className={styles.topPills}>
          <span className={styles.pill}>{view.dryRunPill}</span>
          <span className={modelIsJev ? styles.pillJev : styles.pill}>{modelPill}</span>
        </div>
      </header>

      <div className={styles.body}>
        <main className={styles.main}>
          <section className={styles.decisionBar}>
            <div className={`${styles.decision} ${actionClass(showTone)}`}>
              <span className={styles.decisionLabel}>Decision</span>
              <span className={styles.decisionAction}>{showAction}</span>
              <span className={styles.carried}>{carried || " "}</span>
            </div>
            <div className={styles.decisionMeta}>
              <div>
                <span className={styles.lbl}>confidence</span>
                <span className={styles.val}>{stripConfidence}</span>
              </div>
              <div>
                <span className={styles.lbl}>latency</span>
                <span className={styles.val}>{stripLatency}</span>
              </div>
              <div>
                <span className={styles.lbl}>block</span>
                <span className={styles.val}>{stripBlock}</span>
              </div>
              <div>
                <span className={styles.lbl}>{usingDesk ? "p_long" : "upIn10"}</span>
                <span className={styles.val}>{stripUpIn10}</span>
              </div>
            </div>
            <div className={styles.probBars}>
              {stripBars.map((b) => (
                <div key={b.name} className={styles.probRow}>
                  <span className={styles.probName}>{b.name}</span>
                  <div className={styles.probTrack}>
                    <div className={`${styles.probFill} ${actionClass(b.tone)}`} style={{ width: `${b.width}%` }} />
                  </div>
                  <span className={styles.probPct}>{b.label}</span>
                </div>
              ))}
            </div>
          </section>

          {hint ? <div className={styles.feedHint}>{hint}</div> : null}
          <ChartStack events={chartEvents} seriesKey={desk.selected ?? "feed"} btc={btc} btcOn={btcOn} onToggleBtc={() => setBtcOn((v) => !v)} />
        </main>

        <aside className={styles.rail}>
          <div className={styles.watchlist}>
            <div className={styles.railHead}>Watchlist</div>
            {desk.symbols.length === 0 ? (
              <div className={styles.watchEmpty}>
                {desk.connection === "live" ? "Empty watchlist" : "Connecting to desk…"}
              </div>
            ) : (
              <ul className={styles.watchRows}>
                {desk.symbols.map((s) => {
                  const dec = decisionForSymbol(desk.decisions, s.symbol);
                  const active = s.symbol === desk.selected;
                  const act =
                    dec?.action === "long" || dec?.action === "buy"
                      ? "L"
                      : dec?.action === "short" || dec?.action === "sell"
                        ? "S"
                        : dec
                          ? "H"
                          : "·";
                  return (
                    <li key={s.symbol} className={styles.watchItem}>
                      <button
                        type="button"
                        className={active ? styles.watchRowActive : styles.watchRow}
                        onClick={() => desk.setSelected(s.symbol)}
                      >
                        <span className={styles.watchSym}>{s.symbol}</span>
                        <span className={`${styles.watchAct} ${actionClass(
                          act === "L" ? "long" : act === "S" ? "short" : act === "H" ? "hold" : "",
                        )}`}>
                          {act}
                        </span>
                        <span className={styles.watchVenue}>{s.venue}</span>
                      </button>
                      <button
                        type="button"
                        className={styles.watchDel}
                        aria-label={`Remove ${s.symbol}`}
                        disabled={busy}
                        onClick={() => void onRemove(s.symbol)}
                      >
                        ×
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <form className={styles.watchAdd} onSubmit={(e) => void onAdd(e)}>
              <input
                className={styles.watchInput}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Add symbol"
                aria-label="Add symbol"
                disabled={busy}
              />
              <button type="submit" className={styles.watchAddBtn} disabled={busy || !draft.trim()}>
                Add
              </button>
            </form>
            {formErr ? <div className={styles.watchErr}>{formErr}</div> : null}
          </div>
          <div className={styles.symbolDetail}>
            <div className={styles.railHead}>Symbol detail</div>
            <dl className={styles.detailGrid}>
              <div>
                <dt>Position</dt>
                <dd
                  className={
                    (deskDetail?.tone ?? view.positionTone) === "long"
                      ? styles.up
                      : (deskDetail?.tone ?? view.positionTone) === "short"
                        ? styles.dn
                        : undefined
                  }
                >
                  {deskDetail?.side ?? view.positionSide}
                </dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>{deskDetail ? deskDetail.size : view.size}</dd>
              </div>
              <div>
                <dt>Entry</dt>
                <dd>{deskDetail ? deskDetail.entryText : view.entry}</dd>
              </div>
              <div>
                <dt>Notional</dt>
                <dd>{deskDetail ? deskDetail.notional : view.notional}</dd>
              </div>
              <div>
                <dt>Unrealized</dt>
                <dd className={moneyClass(deskDetail?.unrealizedTone ?? view.unrealized.tone)}>
                  {deskDetail ? deskDetail.unrealizedText : view.unrealized.text}
                </dd>
              </div>
              <div>
                <dt>Paper PnL</dt>
                <dd className={moneyClass(deskDetail?.paperTone ?? view.paperPnl.tone)}>
                  {deskDetail ? deskDetail.paperText : view.paperPnl.text}
                </dd>
              </div>
              <div>
                <dt>Resting</dt>
                <dd>{deskDetail ? "—" : view.resting}</dd>
              </div>
              <div>
                <dt>Quote</dt>
                <dd>{deskDetail ? "—" : view.quote.text}</dd>
              </div>
              <div>
                <dt>Fills</dt>
                <dd>{deskDetail ? "—" : view.stats.fills}</dd>
              </div>
              <div>
                <dt>Late blocks</dt>
                <dd>{deskDetail ? "—" : view.stats.blockedLate}</dd>
              </div>
            </dl>
          </div>
        </aside>
      </div>

      <footer className={styles.statusBar}>
        <span className={styles.statusItem}>
          <span className={view.dot === "live" ? styles.dotLive : styles.dotWait} aria-hidden />
          desk {desk.connection}
        </span>
        <span className={styles.statusItem}>dryRun {paper ? "true" : "false"}</span>
        <span className={styles.statusItem}>{modelPill}</span>
        <span className={styles.statusItem}>latency {view.latency}</span>
        <span className={styles.statusItem}>uptime {uptime}</span>
        <span className={styles.statusItem}>api {deskUrl.replace(/^https?:\/\//, "")}</span>
        <span className={styles.statusLock}>paper only</span>
      </footer>
    </div>
  );
}
