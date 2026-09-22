"use client";

import { useEffect, useRef } from "react";
import styles from "./Desk.module.css";
import { toTvSymbol } from "./tvSymbol";

const SRC = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";

/** Hosted TradingView advanced-chart embed. Branding stays on the widget default. */
export default function TvRefChart({ symbol }: { symbol: string | null }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const tv = toTvSymbol(symbol);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !tv) return;
    const container = document.createElement("div");
    container.className = "tradingview-widget-container";
    container.style.height = "100%";
    container.style.width = "100%";
    const slot = document.createElement("div");
    slot.className = "tradingview-widget-container__widget";
    slot.style.height = "calc(100% - 32px)";
    slot.style.width = "100%";
    const credit = document.createElement("div");
    credit.className = "tradingview-widget-copyright";
    const link = document.createElement("a");
    link.href = "https://www.tradingview.com/";
    link.target = "_blank";
    link.rel = "noopener nofollow";
    const label = document.createElement("span");
    label.className = "blue-text";
    label.textContent = "Track all markets on TradingView";
    link.append(label);
    credit.append(link);
    const script = document.createElement("script");
    script.src = SRC;
    script.async = true;
    script.type = "text/javascript";
    script.text = JSON.stringify({
      autosize: true,
      symbol: tv,
      interval: "1",
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",
      locale: "en",
      allow_symbol_change: false,
      support_host: "https://www.tradingview.com",
    });
    container.append(slot, credit, script);
    host.replaceChildren(container);
    return () => host.replaceChildren();
  }, [tv]);

  if (!tv) {
    return (
      <div className={styles.chartStack}>
        <div className={styles.chartEmpty}>
          No TradingView symbol for {symbol?.trim() || "this selection"}. Use Desk (LWC).
        </div>
      </div>
    );
  }

  return (
    <div className={styles.chartStack}>
      <div className={styles.tvHost} ref={hostRef} />
    </div>
  );
}
