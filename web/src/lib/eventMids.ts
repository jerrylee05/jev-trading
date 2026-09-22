import type { TimedPrice } from "./series";
import type { BlockEvent } from "./types";

/** Chart series input: skip late blocks and null mids so delayed emits cannot double-print. */
export function eventMids(events: BlockEvent[]): TimedPrice[] {
  const out: TimedPrice[] = [];
  for (const e of events) {
    if (e.decision?.late) continue;
    if (e.mid == null || !Number.isFinite(e.mid)) continue;
    if (!Number.isFinite(e.ts)) continue;
    out.push({ ts: e.ts, mid: e.mid });
  }
  return out;
}
