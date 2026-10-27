/**
 * `palestra-worker` entry point (KOI-364, ADR 0008): runs the Market Watch pg-boss jobs, off the
 * 256 MB web VM. Same image as `palestra`, started with `node dist/worker.mjs` (fly.worker.toml).
 * Loads the worker env only; migrations stay on `palestra`'s release command.
 */
import { marketDeps } from "@life-tracker/api/lib/market/deps";
import { createBoss, startWorker } from "@life-tracker/api/lib/market/worker";
import { env } from "@life-tracker/env/worker";

const boss = createBoss(env.DATABASE_URL);
await startWorker(boss, marketDeps());
console.log("[worker] started: market jobs registered");

async function shutdown(signal: string) {
  console.log(`[worker] ${signal}: stopping pg-boss`);
  await boss.stop({ graceful: true, timeout: 30_000 });
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
