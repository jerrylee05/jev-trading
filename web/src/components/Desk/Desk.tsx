import {
  COPY,
  UNMAPPED_CHECKS,
  UNMAPPED_SCORES,
  buildDesk,
  checklistHasFeed,
  scoresHaveFeed,
  type DeskModel,
  type MoneyTone,
  type SparkFill,
  type SparkModel,
} from "@/lib/deskView";
import type { FeedState } from "@/lib/types";
import styles from "./Desk.module.css";

function toneClass(tone: MoneyTone | "amber" | undefined): string {
  if (tone === "up") return styles.up;
  if (tone === "dn") return styles.dn;
  if (tone === "amber") return styles.amber;
  return styles.flat;
}

function Spark({ spark }: { spark: SparkModel }) {
  const stroke = spark.tone === "short" ? "#ef4444" : spark.tone === "long" ? "#22c55e" : "#94a3b8";
  return (
    <div className={styles.spark}>
      <span className={styles.sparkTag}>{COPY.chart}</span>
      <svg viewBox="0 0 400 72" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="deskSpark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.25} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>
        {spark.entryY != null ? (
          <line x1={0} y1={spark.entryY} x2={400} y2={spark.entryY} stroke="rgba(232,238,248,0.28)" strokeWidth={1} strokeDasharray="3 3" />
        ) : null}
        {spark.area ? <path d={spark.area} fill="url(#deskSpark)" /> : null}
        {spark.line ? <path d={spark.line} fill="none" stroke={stroke} strokeWidth={1.5} /> : null}
        {spark.fills.map((f, i) => (
          <polygon key={i} points={triangle(f)} fill={f.tone === "short" ? "#ef4444" : "#22c55e"} />
        ))}
        {spark.marker ? <circle cx={spark.marker.x} cy={spark.marker.y} r={3.5} fill={stroke} /> : null}
      </svg>
      {spark.marker ? (
        <span
          className={spark.marker.tone === "short" ? styles.markerShort : styles.markerLong}
          style={{
            left: `${(spark.marker.x / 400) * 100}%`,
            top: `${Math.min(64, Math.max(22, (spark.marker.y / 72) * 100))}%`,
          }}
        >
          {spark.marker.label}
        </span>
      ) : null}
    </div>
  );
}

function triangle(f: SparkFill): string {
  const { x, y } = f;
  if (f.tone === "short") return `${x},${y + 4} ${x - 3.5},${y - 3} ${x + 3.5},${y - 3}`;
  return `${x},${y - 4} ${x - 3.5},${y + 3} ${x + 3.5},${y + 3}`;
}

function DeskBody({ view }: { view: DeskModel }) {
  const paper = view.stripe === "PAPER";
  const posClass = view.positionTone === "long" ? styles.posLong : view.positionTone === "short" ? styles.posShort : styles.posFlat;
  return (
    <div className={styles.desk}>
      <div className={paper ? styles.banner : `${styles.banner} ${styles.bannerLive}`}>
        <div className={styles.bannerLeft}>
          <span className={paper ? styles.stripe : `${styles.stripe} ${styles.stripeLive}`}>{view.stripe}</span>
          <span>{view.banner}</span>
        </div>
        <div className={styles.bannerRight}>
          <span className={`${styles.pill} ${styles.pillDry}`}>{view.dryRunPill}</span>
          <span className={`${styles.pill} ${view.modelIsJev ? styles.pillJev : styles.pillModel}`}>{view.modelPill}</span>
        </div>
      </div>

      <header className={styles.header}>
        <div>
          <div className={styles.kicker}>{COPY.kicker}</div>
          <h1 className={styles.title}>
            <span className={`${styles.dot} ${view.dot === "live" ? styles.dotLive : styles.dotWait}`} aria-hidden="true" />
            {COPY.title}
            <span className={styles.pair}>{COPY.pair}</span>
          </h1>
        </div>
        <div className={styles.meta}>
          <div className={styles.chip}>
            <span className={styles.lbl}>{COPY.gateway}</span>
            <span className={`${styles.chipVal} ${styles.cyan}`}>{view.gateway}</span>
          </div>
          <div className={styles.chip}>
            <span className={styles.lbl}>{COPY.block}</span>
            <span className={styles.chipVal}>{view.block}</span>
          </div>
          <div className={styles.chip}>
            <span className={styles.lbl}>{COPY.paperPnl}</span>
            <span className={`${styles.chipVal} ${toneClass(view.paperPnl.tone)}`}>{view.paperPnl.text}</span>
          </div>
          <div className={styles.chip}>
            <span className={styles.lbl}>{COPY.account}</span>
            <span className={styles.chipVal}>{view.account}</span>
          </div>
        </div>
      </header>

      <div className={styles.grid}>
        <section className={`${styles.pane} ${styles.decision}`} data-tone={view.actionTone === "empty" ? "hold" : view.actionTone}>
          <div className={styles.pt}>
            <span>{COPY.lastDecision}</span>
            <span className={styles.sub}>{COPY.choiceTick}</span>
          </div>
          <div className={styles.action} data-tone={view.actionTone}>{view.action}</div>
          <div className={styles.confRow}>
            <span className={styles.confPct}>{view.confidence}</span>
            <span className={styles.confLbl}>{COPY.confidence}</span>
            <span className={styles.lat}>
              <span>{COPY.latency}</span> {view.latency}
            </span>
          </div>
          <div className={styles.bars}>
            {view.bars.map((bar) => (
              <div className={styles.prob} key={bar.name}>
                <span className={bar.tone === "long" ? styles.nameLong : bar.tone === "short" ? styles.nameShort : styles.name}>{bar.name}</span>
                <div className={styles.track}>
                  <div
                    className={bar.tone === "long" ? styles.fillLong : bar.tone === "short" ? styles.fillShort : styles.fillHold}
                    style={{ width: `${bar.width}%`, height: "100%", borderRadius: 4 }}
                  />
                </div>
                <span className={styles.pct}>{bar.label}</span>
              </div>
            ))}
          </div>
          <div className={styles.decisionMeta}>
            <div className={styles.dm}>
              <span className={styles.lbl}>{COPY.quoteSide}</span>
              <div className={`${styles.dmVal} ${view.quote.tone === "long" ? styles.up : view.quote.tone === "short" ? styles.dn : ""}`}>{view.quote.text}</div>
            </div>
            <div className={styles.dm}>
              <span className={styles.lbl}>{COPY.horizon}</span>
              <div className={styles.dmVal}>{view.horizon}</div>
            </div>
            <div className={styles.dm}>
              <span className={styles.lbl}>{COPY.upIn10}</span>
              <div className={styles.dmVal}>{view.upIn10}</div>
            </div>
            <div className={styles.dm}>
              <span className={styles.lbl}>{COPY.late}</span>
              <div className={`${styles.dmVal} ${toneClass(view.late.tone)}`}>{view.late.text}</div>
            </div>
          </div>
        </section>

        <div className={styles.center}>
          <section className={`${styles.pane} ${styles.book}`}>
            <div className={styles.bookHead}>
              <div>
                <div className={styles.pt}>
                  <span>{COPY.liveBook}</span>
                  <span className={styles.sub}>{view.bookSub}</span>
                </div>
                <div className={styles.mid}>{view.mid}</div>
              </div>
              <div>
                <div className={styles.spread}>{view.spread}</div>
                <div className={styles.spread}>{view.touch}</div>
              </div>
            </div>
            <div className={styles.bookCols}>
              <div className={`${styles.sideCol} ${styles.bid}`}>
                <h4>{COPY.bids}</h4>
                {view.bids.map((row, i) => (
                  <div key={`b${i}`} className={`${styles.lvl} ${row.empty ? styles.lvlEmpty : styles.lvlBid}`}>
                    <span className={styles.px}>{row.price}</span>
                    <span className={styles.sz}>{row.size}</span>
                  </div>
                ))}
              </div>
              <div className={`${styles.sideCol} ${styles.ask}`}>
                <h4>{COPY.asks}</h4>
                {view.asks.map((row, i) => (
                  <div key={`a${i}`} className={`${styles.lvl} ${row.empty ? styles.lvlEmpty : styles.lvlAsk}`}>
                    <span className={styles.px}>{row.price}</span>
                    <span className={styles.sz}>{row.size}</span>
                  </div>
                ))}
              </div>
            </div>
            <Spark spark={view.spark} />
          </section>
          <div className={styles.stats}>
            <div className={styles.stat}>
              <div className={styles.lbl}>{COPY.blocks}</div>
              <div className={styles.statVal}>{view.stats.blocks}</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.lbl}>{COPY.decisions}</div>
              <div className={styles.statVal}>{view.stats.decisions}</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.lbl}>{view.stats.fillsLabel}</div>
              <div className={`${styles.statVal} ${view.stats.fillsAmber ? styles.amber : ""}`}>{view.stats.fills}</div>
            </div>
            <div className={styles.stat} title="Blocked is not a totals field. Late is lateBlocks.">
              <div className={styles.lbl}>{COPY.blockedLate}</div>
              <div className={styles.statVal}>{view.stats.blockedLate}</div>
            </div>
          </div>
        </div>

        <div className={styles.right}>
          <section className={styles.pane}>
            <div className={styles.pt}>
              <span>{COPY.position}</span>
              <span className={`${styles.posSide} ${posClass}`}>{view.positionSide}</span>
            </div>
            <div className={styles.kv}><span className={styles.k}>{COPY.size}</span><span className={styles.v}>{view.size}</span></div>
            <div className={styles.kv}><span className={styles.k}>{COPY.entry}</span><span className={styles.v}>{view.entry}</span></div>
            <div className={styles.kv}><span className={styles.k}>{COPY.notional}</span><span className={styles.v}>{view.notional}</span></div>
            <div className={styles.kv}><span className={styles.k}>{COPY.unrealized}</span><span className={toneClass(view.unrealized.tone)}>{view.unrealized.text}</span></div>
            <div className={styles.kv}><span className={styles.k}>{COPY.resting}</span><span className={styles.v}>{view.resting}</span></div>
          </section>
          <section className={styles.pane} title="Momentum, retrace risk, and book pressure are not in the trader status.">
            <div className={`${styles.pt} ${styles.tight}`}>
              <span>{COPY.scores}</span>
              <span className={styles.sub}>{COPY.parallel}</span>
            </div>
            {scoresHaveFeed() ? (
              UNMAPPED_SCORES.map((row) => (
                <div className={styles.scoreRow} key={row.label}>
                  <span>{row.label}</span>
                  <div className={styles.scoreBar}><i /></div>
                  <span className={styles.scoreVal}>{row.value}</span>
                </div>
              ))
            ) : (
              <p className={styles.awaitingFeed}>{COPY.awaitingFeed}</p>
            )}
          </section>
          <section className={`${styles.pane} ${styles.grow}`} title="Noul checklist is not in the trader status.">
            <div className={styles.pt}>
              <span>{COPY.checklist}</span>
              <span className={styles.sub}>{COPY.gate}</span>
            </div>
            {checklistHasFeed() ? (
              <div className={styles.noul}>
                {UNMAPPED_CHECKS.map((row) => (
                  <div className={styles.noulItem} key={row.label}>
                    <span className={styles.noulDot} />
                    <span className={styles.noulLab}>{row.label}</span>
                    <span className={styles.noulAns}>{row.answer}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.awaitingFeed}>{COPY.awaitingFeed}</p>
            )}
          </section>
        </div>
      </div>

      <footer className={styles.footer}>
        <div>
          JoCoding Futures Desk | overlays <code>GET {view.footerApi}</code> dry-run JSON | {view.connection}
        </div>
        <div className={styles.footerRight}>
          <span className={paper ? styles.badge : `${styles.badge} ${styles.badgeLive}`}>{view.stripe}</span>
          <span>{COPY.unlock}</span>
        </div>
      </footer>
    </div>
  );
}

export default function Desk({ feed, apiUrl }: { feed: FeedState; apiUrl: string }) {
  const view = buildDesk(feed.meta, feed.latest, feed.events, feed.connection, apiUrl);
  return <DeskBody view={view} />;
}
