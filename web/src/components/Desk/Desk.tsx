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
  const showAction = usingDesk
    ? deskUi?.action === "buy"
      ? "LONG"
      : deskUi?.action === "sell"
        ? "SHORT"
        : deskUi
          ? "HOLD"
          : "—"
    : view.late.text === "true" && view.carriedAction
      ? view.carriedAction
      : view.action;
  const showTone = usingDesk
    ? deskUi?.action === "buy"
      ? "long"
      : deskUi?.action === "sell"
        ? "short"
        : deskUi
          ? "hold"
          : "empty"
    : view.late.text === "true" && view.carriedAction
      ? "hold"
      : view.actionTone;
  const carried = usingDesk
    ? deskDec
      ? fmtCarried(Date.now() - deskDec.t)
      : null
    : fmtCarried(view.carriedAgeMs);

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

  return (
    <div className={styles.shell}>
      <header className={styles.topBar}>
        <div className={styles.brand}>
          <span className={styles.title}>{COPY.title}</span>
          <span className={paper ? styles.paperPill : styles.livePill}>{view.stripe}</span>
          <span className={styles.pair}>{desk.selected ?? "MULTI"}</span>
        </div>
        <div className={styles.quoteStrip}>
          <span className={styles.last}>{view.mid}</span>
          <span className={styles.muted}>{view.spread}</span>
          <span className={styles.muted}>{view.touch}</span>
        </div>
        <div className={styles.topPills}>
          <span className={styles.pill}>{view.dryRunPill}</span>
          <span className={view.modelIsJev ? styles.pillJev : styles.pill}>{view.modelPill}</span>
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
                <span className={styles.val}>{view.confidence}</span>
              </div>
              <div>
                <span className={styles.lbl}>latency</span>
                <span className={styles.val}>{view.latency}</span>
              </div>
              <div>
                <span className={styles.lbl}>block</span>
                <span className={styles.val}>{view.block}</span>
              </div>
              <div>
                <span className={styles.lbl}>upIn10</span>
                <span className={styles.val}>{view.upIn10}</span>
              </div>
            </div>
            <div className={styles.probBars}>
              {view.bars.map((b) => (
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
                <dd className={view.positionTone === "long" ? styles.up : view.positionTone === "short" ? styles.dn : undefined}>
                  {view.positionSide}
                </dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>{view.size}</dd>
              </div>
              <div>
                <dt>Entry</dt>
                <dd>{view.entry}</dd>
              </div>
              <div>
                <dt>Notional</dt>
                <dd>{view.notional}</dd>
              </div>
              <div>
                <dt>Unrealized</dt>
                <dd className={moneyClass(view.unrealized.tone)}>{view.unrealized.text}</dd>
              </div>
              <div>
                <dt>Paper PnL</dt>
                <dd className={moneyClass(view.paperPnl.tone)}>{view.paperPnl.text}</dd>
              </div>
              <div>
                <dt>Resting</dt>
                <dd>{view.resting}</dd>
              </div>
              <div>
                <dt>Quote</dt>
                <dd>{view.quote.text}</dd>
              </div>
              <div>
                <dt>Fills</dt>
                <dd>{view.stats.fills}</dd>
              </div>
              <div>
                <dt>Late blocks</dt>
                <dd>{view.stats.blockedLate}</dd>
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
        <span className={styles.statusItem}>{view.modelPill}</span>
        <span className={styles.statusItem}>latency {view.latency}</span>
        <span className={styles.statusItem}>uptime {uptime}</span>
        <span className={styles.statusItem}>api {deskUrl.replace(/^https?:\/\//, "")}</span>
        <span className={styles.statusLock}>paper only</span>
      </footer>
    </div>
  );
}
