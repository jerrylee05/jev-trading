import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Re-test append/rotate by importing the module's side effects through a thin harness.
// Trader.emit is private; we exercise rotation via the file helpers by simulating mtimes
// through a duplicated copy of the rotate logic that mirrors trader.ts (kept in sync by this test's string check).

const DATA = join(import.meta.dir, "..", "data-test-phase0");
const EVENTS = join(DATA, "events.jsonl");

function ptDayKey(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function dayKeyFromMtime(ms: number): string {
  return ptDayKey(new Date(ms));
}

function appendEventMirror(line: string) {
  mkdirSync(DATA, { recursive: true });
  if (existsSync(EVENTS)) {
    const mtime = require("node:fs").statSync(EVENTS).mtimeMs as number;
    const fileDay = dayKeyFromMtime(mtime);
    const today = ptDayKey();
    if (fileDay !== today) {
      require("node:fs").renameSync(EVENTS, join(DATA, `events-${fileDay}.jsonl`));
    }
  }
  require("node:fs").appendFileSync(EVENTS, line + "\n");
}

describe("phase0 events.jsonl rotation", () => {
  beforeEach(() => {
    rmSync(DATA, { recursive: true, force: true });
    mkdirSync(DATA, { recursive: true });
  });
  afterEach(() => {
    rmSync(DATA, { recursive: true, force: true });
  });

  test("rotates when file mtime day (PT) differs from today", () => {
    writeFileSync(EVENTS, "{\"block\":1}\n");
    const yesterday = Date.now() - 36 * 3600 * 1000;
    utimesSync(EVENTS, new Date(yesterday), new Date(yesterday));
    const priorDay = dayKeyFromMtime(yesterday);
    expect(priorDay).not.toBe(ptDayKey());
    appendEventMirror("{\"block\":2}");
    expect(existsSync(EVENTS)).toBe(true);
    expect(existsSync(join(DATA, `events-${priorDay}.jsonl`))).toBe(true);
    expect(readFileSync(EVENTS, "utf8").trim()).toBe("{\"block\":2}");
    expect(readFileSync(join(DATA, `events-${priorDay}.jsonl`), "utf8")).toContain("\"block\":1");
  });
});

describe("phase0 late mid contract", () => {
  test("trader source omits mid on late emits", () => {
    const src = readFileSync(join(import.meta.dir, "trader.ts"), "utf8");
    expect(src).toContain("mid: late ? null : book.mid");
    expect(src).toContain("appendEvent(event)");
    expect(src).toContain("events-${fileDay}.jsonl");
    // late path must not push mids
    expect(src).toMatch(/if \(this\.busy\)[\s\S]*?return;/);
    expect(src).toContain("this.mids.push(book.mid)");
  });
});
