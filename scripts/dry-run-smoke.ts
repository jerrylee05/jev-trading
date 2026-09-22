/** Starts the trader briefly and checks the snapshot is dry-run with block events. */
const PORT = Number(process.env.PORT ?? 3000);
const BASE = `http://127.0.0.1:${PORT}`;

const proc = Bun.spawn(["bun", "run", "src/index.ts"], {
  cwd: import.meta.dir + "/..",
  stdout: "pipe",
  stderr: "inherit",
  env: { ...process.env, DRY_RUN: "true", MODEL: "mock", PRIVATE_KEY: "" },
});

const deadline = Date.now() + 30_000;
let snap: any;

while (Date.now() < deadline) {
  try {
    const res = await fetch(`${BASE}/`);
    if (res.ok) {
      snap = await res.json();
      if (snap.dryRun && snap.latest?.block) break;
    }
  } catch {}
  await Bun.sleep(500);
}

proc.kill();

if (!snap?.dryRun) {
  console.error("smoke failed: expected dryRun=true");
  process.exit(1);
}
if (!snap.latest?.block) {
  console.error("smoke failed: no block events yet");
  process.exit(1);
}

console.log(`smoke ok · dryRun=${snap.dryRun} · model=${snap.model} · block=${snap.latest.block}`);
