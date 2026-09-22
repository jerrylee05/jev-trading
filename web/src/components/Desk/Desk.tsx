"use client";

import type { BlockEvent, ConnectionState, FeedState, Quote } from "@/lib/types";
import type { BtcState } from "@/lib/useBtc";
import { fmtInt, fmtPrice } from "@/lib/format";
import ChartStack from "./ChartStack";
import styles from "./desk.module.css";

const NOUL = ["Sell pressure rising", "Spread tradable", "Breakout confirmed", "Allow size"];
const SCORES = ["Momentum", "Retrace risk", "Book pressure"];

function fmtPnl(n: number): string {
  const abs = Math.abs(n);
  const digits = abs >= 1 ? 2 : 4;
  const mag = abs.toFixed(digits);
  return `${n < 0 && Number(mag) !== 0 ? "-" : ""}$${mag}`;
}

function fmtSize(n: number): string {
  const body = Number.isInteger(n) ? n.toFixed(0) : n.toFixed(1);
  return `${body} MON`;
}

function wordOf(action: string | null | undefined): string {
  if (action === "buy") return "LONG";
  if (action === "sell") return "SHORT";
  if (action === "hold") return "HOLD";
  return "-";
}

function quoteLabel(q: Quote | null | undefined): string {
  if (!q) return "none";
  return `${q.side} | ${q.status === "sim" ? "sim" : q.status}`;
}

function barPct(p: number | undefined): string {
  if (typeof p !== "number" || !Number.isFinite(p)) return "-";
  return `${Math.round(p * 100)}%`;
}

function barWidth(p: number | undefined): string {
  if (typeof p !== "number" || !Number.isFinite(p)) return "0%";
  return `${Math.max(0, Math.min(100, p * 100))}%`;
}

function DecisionPane({ latest }: { latest: BlockEvent | null }) {
  const decision = latest?.decision ?? null;
  const action = decision?.action ?? null;
  const tone = action === "buy" ? "long" : action === "sell" ? "short" : "hold";
  const pane =
    tone === "long" ? styles.decisionLong : tone === "short" ? styles.decisionShort : styles.decision;
  const wordClass =
    tone === "long" ? styles.actionLong : tone === "short" ? styles.actionShort : styles.actionHold;
  const probs = decision?.probabilities ?? { buy: 0, sell: 0, hold: 0 };
  const conf = decision ? (probs[decision.action] ?? 0) * 100 : null;
  const latency =
    !decision ? "-" : decision.late ? "late" : `${Math.round(decision.latencyMs)} ms`;
  const quote = latest?.quote;
  const quoteColor = quote?.side === "buy" ? styles.up : quote?.side === "sell" ? styles.dn : undefined;

  return (
    <div className={pane}>
      <div className={styles.pt}>
        <span>Last decision</span>
        <span className={styles.sub}>Choice | tick</span>
      </div>
      <div className={`${styles.action} ${wordClass}`}>{wordOf(action)}</div>
      <div className={styles.confRow}>
        <span className={styles.confPct}>{conf == null ? "-" : `${conf.toFixed(1)}%`}</span>
        <span className={styles.confLbl}>confidence</span>
        <span className={styles.lat}>
          <span>latency</span>
          {latency}
        </span>
      </div>
      <div className={styles.probs}>
        <div className={styles.prob}>
          <span className={`${styles.name} ${styles.nameLong}`}>LONG</span>
          <div className={styles.track}>
            <div className={`${styles.fill} ${styles.fillLong}`} style={{ width: barWidth(probs.buy) }} />
          </div>
          <span className={styles.pct}>{decision ? barPct(probs.buy) : "-"}</span>
        </div>
        <div className={styles.prob}>
          <span className={`${styles.name} ${styles.nameShort}`}>SHORT</span>
          <div className={styles.track}>
            <div className={`${styles.fill} ${styles.fillShort}`} style={{ width: barWidth(probs.sell) }} />
          </div>
          <span className={styles.pct}>{decision ? barPct(probs.sell) : "-"}</span>
        </div>
        <div className={styles.prob}>
          <span className={styles.name}>HOLD</span>
          <div className={styles.track}>
            <div className={`${styles.fill} ${styles.fillHold}`} style={{ width: barWidth(probs.hold) }} />
          </div>
          <span className={styles.pct}>{decision ? barPct(probs.hold) : "-"}</span>
        </div>
      </div>
      <div className={styles.decisionMeta}>
        <div className={styles.dm}>
          <div className={styles.l}>Quote side</div>
          <div className={`${styles.v} ${quoteColor ?? ""}`}>{quoteLabel(quote)}</div>
        </div>
        <div className={styles.dm} title="Horizon blocks are not in the paper feed">
          <div className={styles.l}>Horizon</div>
          <div className={styles.v}>N/A</div>
        </div>
        <div className={styles.dm}>
          <div className={styles.l}>upIn10</div>
          <div className={styles.v}>{decision ? decision.upIn10.toFixed(3) : "-"}</div>
        </div>
        <div className={styles.dm}>
          <div className={styles.l}>Late?</div>
          <div className={`${styles.v} ${decision ? (decision.late ? styles.dn : styles.up) : ""}`}>
            {decision ? String(decision.late) : "-"}
          </div>
        </div>
      </div>
    </div>
  );
}

function RightRail({ latest }: { latest: BlockEvent | null }) {
  const pos = latest?.position;
  const side = pos?.side ?? "flat";
  const sideClass = side === "long" ? styles.posLong : side === "short" ? styles.posShort : styles.posFlat;
  const entry = pos?.entryPrice != null ? fmtPrice(pos.entryPrice) : "N/A";
  const notional =
    pos && pos.size > 0 && latest
      ? fmtPnl((pos.entryPrice ?? latest.mid) * pos.size).replace(/^-/, "")
      : "N/A";
  const unreal = pos ? fmtPnl(pos.unrealizedUsd) : "-";
  const unrealDn = (pos?.unrealizedUsd ?? 0) < 0;

  return (
    <div className={styles.rightCol}>
      <div className={styles.pane}>
        <div className={styles.pt}>
          <span>Position</span>
          <span className={`${styles.posSide} ${sideClass}`}>{side.toUpperCase()}</span>
        </div>
        <div className={styles.kv}>
          <span className={styles.k}>Size</span>
          <span className={styles.v}>{pos ? fmtSize(pos.size) : "-"}</span>
        </div>
        <div className={styles.kv}>
          <span className={styles.k}>Entry</span>
          <span className={styles.v}>{entry}</span>
        </div>
        <div className={styles.kv}>
          <span className={styles.k}>Notional</span>
          <span className={styles.v}>{notional}</span>
        </div>
        <div className={styles.kv}>
          <span className={styles.k}>Unrealized</span>
          <span className={`${styles.v} ${unrealDn ? styles.dn : ""}`}>{unreal}</span>
        </div>
      </div>
      <div className={styles.pane}>
        <div className={styles.pt}>
          <span>Book</span>
          <span className={styles.sub}>top of book</span>
        </div>
        <div className={styles.spread}>
          {latest
            ? `mid ${fmtPrice(latest.mid)} | spr ${latest.spreadBps.toFixed(2)} bps`
            : "mid - | spr -"}
        </div>
        <div className={styles.miniBook}>
          <div className={styles.bid}>
            <h4>Bids</h4>
            <Level kind="bid" px={latest ? fmtPrice(latest.bestBid) : "-"} sz="N/A" />
            <Level kind="empty" px="N/A" sz="N/A" />
            <Level kind="empty" px="N/A" sz="N/A" />
          </div>
          <div className={styles.ask}>
            <h4>Asks</h4>
            <Level kind="ask" px={latest ? fmtPrice(latest.bestAsk) : "-"} sz="N/A" />
            <Level kind="empty" px="N/A" sz="N/A" />
            <Level kind="empty" px="N/A" sz="N/A" />
          </div>
        </div>
        <div className={styles.bookNote}>size not in feed | deeper levels N/A</div>
      </div>
      <div className={styles.pane}>
        <div className={styles.pt}>
          <span>Scores</span>
          <span className={styles.sub}>not in feed</span>
        </div>
        {SCORES.map((name) => (
          <div className={styles.scoreRow} key={name} title="This gate is not in the paper feed">
            <span>{name}</span>
            <div className={styles.scoreBar} />
            <span className={styles.scoreNum}>N/A</span>
          </div>
        ))}
      </div>
      <div className={styles.pane}>
        <div className={styles.pt}>
          <span>Noul checklist</span>
          <span className={styles.sub}>not in feed</span>
        </div>
        <div className={styles.noul}>
          {NOUL.map((lab) => (
            <div className={styles.noulItem} key={lab} title="This gate is not in the paper feed">
              <span className={styles.noulDot} />
              <span className={styles.noulLab}>{lab}</span>
              <span className={styles.noulAns}>N/A</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Level({ kind, px, sz }: { kind: "bid" | "ask" | "empty"; px: string; sz: string }) {
  const cls = kind === "bid" ? styles.lvlBid : kind === "ask" ? styles.lvlAsk : styles.lvlEmpty;
  return (
    <div className={`${styles.lvl} ${cls}`}>
      <span className={styles.px}>{px}</span>
      <span className={styles.sz}>{sz}</span>
    </div>
  );
}

export default function Desk({ feed, btc }: { feed: FeedState; btc: BtcState }) {
  const { meta, latest, connection } = feed;
  const dry = meta ? String(meta.dryRun) : "...";
  const model = meta?.model || "...";
  const latency =
    !latest?.decision ? "-" : latest.decision.late ? "late" : `${Math.round(latest.decision.latencyMs)} ms`;
  const pnl = latest ? fmtPnl(latest.totals.pnlUsd) : "-";
  const pnlDn = (latest?.totals.pnlUsd ?? 0) < 0;
  const offline: ConnectionState | null = connection === "live" ? null : connection;

  return (
    <div className={styles.desk}>
      <div className={styles.banner}>
        <div className={styles.bannerLeft}>
          <span className={styles.stripe}>PAPER</span>
          <span>DRY-RUN | simulated fills | no live money | Bit9 :3010 overlay | live still locked</span>
        </div>
        <div className={styles.bannerRight}>
          <span className={styles.pillDry}>dryRun={dry}</span>
          <span className={styles.pillModel}>MODEL={model}</span>
        </div>
      </div>

      <header className={styles.header}>
        <div>
          <div className={styles.kicker}>JoCoding Futures Desk | Jev decision layer | chart expand</div>
          <h1 className={styles.title}>
            <span className={connection === "live" ? styles.liveDotOn : styles.liveDot} />
            JEV Decision
            <span className={styles.pair}>MON-USDC | Kuru</span>
            {offline ? <span className={styles.status}>{offline}</span> : null}
          </h1>
        </div>
        <div className={styles.meta}>
          <div className={styles.chip}>
            <span className={styles.lbl}>Gateway</span>
            <span className={`${styles.val} ${styles.cyan}`}>{latency}</span>
          </div>
          <div className={styles.chip}>
            <span className={styles.lbl}>Block</span>
            <span className={styles.val}>{latest ? `#${fmtInt(latest.block)}` : "-"}</span>
          </div>
          <div className={styles.chip}>
            <span className={styles.lbl}>Paper PnL</span>
            <span className={`${styles.val} ${pnlDn ? styles.dn : ""}`}>{pnl}</span>
          </div>
          <div className={styles.chip} title="Account equity is not in the paper feed">
            <span className={styles.lbl}>Account</span>
            <span className={`${styles.val} ${styles.dim}`}>N/A</span>
          </div>
        </div>
      </header>

      <div className={styles.grid}>
        <DecisionPane latest={latest} />
        <ChartStack events={feed.events} btc={btc} />
        <RightRail latest={latest} />
      </div>

      <footer className={styles.footer}>
        <div>
          look1-chart | paper mids from <code>GET http://127.0.0.1:3010</code> | candles, MACD and RSI from that window
        </div>
        <div className={styles.footerRight}>
          <span className={styles.badge}>PAPER</span>
          <span>live locked</span>
        </div>
      </footer>
    </div>
  );
}
