import net from "node:net";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const dotenvPort = existsSync(join(root, ".env"))
  ? readFileSync(join(root, ".env"), "utf8").match(/^PORT=(.*)$/m)?.[1]?.trim()
  : undefined;
/** Honor `PORT=` on the command line; ignore the same value copied into `.env` (often :3000 on Bit9). */
const portFromCli = process.env.PORT && process.env.PORT !== dotenvPort ? Number(process.env.PORT) : undefined;

const canBind = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen({ port, host: "127.0.0.1" }, () => s.close(() => resolve(true)));
  });

/** Bind from `start` upward, then fall back to an OS-assigned port. */
async function pickFreePort(start = 3010): Promise<number> {
  for (let port = start; port < start + 100; port++) {
    if (await canBind(port)) return port;
  }
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen({ port: 0, host: "127.0.0.1" }, () => {
      const addr = s.address();
      const port = typeof addr === "object" && addr ? addr.port : undefined;
      s.close(() => (port ? resolve(port) : reject(new Error("no port"))));
    });
  });
}

const port = portFromCli || (await pickFreePort());
const base = `http://127.0.0.1:${port}`;

const proc = Bun.spawn(["bun", "run", "src/index.ts"], {
  cwd: import.meta.dir + "/..",
  stdout: "pipe",
  stderr: "inherit",
  env: {
    ...process.env,
    PORT: String(port),
    DRY_RUN: "true",
    MODEL: "mock",
    PRIVATE_KEY: "",
  },
});

const deadline = Date.now() + 30_000;
let snap: Record<string, unknown> | undefined;

while (Date.now() < deadline) {
  try {
    const res = await fetch(`${base}/`);
    const ct = res.headers.get("content-type") ?? "";
    if (!res.ok || !ct.includes("application/json")) {
      await Bun.sleep(500);
      continue;
    }
    const body = await res.json();
    if (body.dryRun === true && body.latest?.block) {
      snap = body;
      break;
    }
  } catch {}
  await Bun.sleep(500);
}

proc.kill();

if (!snap) {
  console.error(`smoke failed: no trader JSON on ${base}/ (is another app on that port?)`);
  process.exit(1);
}
if (snap.dryRun !== true) {
  console.error("smoke failed: expected dryRun=true");
  process.exit(1);
}
if (!(snap.latest as { block?: number } | undefined)?.block) {
  console.error("smoke failed: no block events yet");
  process.exit(1);
}

console.log(`smoke ok · port=${port} · dryRun=${snap.dryRun} · model=${snap.model} · block=${(snap.latest as { block: number }).block}`);
