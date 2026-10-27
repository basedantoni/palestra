/**
 * Run or enqueue a Market Watch job by hand (KOI-364, ADR 0008). Against prod, go through the
 * prod-db proxy; there is no public dashboard or endpoint.
 *
 * Run: pnpm market:job <job> [--date YYYY-MM-DD] [--source ecb] [--enqueue]
 *
 *   scripts/with-prod-db.sh pnpm market:job market.ecb-history          # one-time ECB history load
 *   scripts/with-prod-db.sh pnpm market:job market.derive --source ecb --date 2026-10-26
 *   scripts/with-prod-db.sh pnpm market:job market.ecb --enqueue        # palestra-worker runs it
 *   scripts/with-prod-db.sh pnpm market:dashboard                       # @pg-boss/dashboard
 *
 * --enqueue needs only DATABASE_URL. Without it the job runs in this process, so it also needs the
 * worker-only Tigris vars in apps/server/.env. --date is the capture day (default: today, UTC);
 * --source is market.derive's.
 */
import "dotenv/config";
import { parseArgs } from "node:util";

import { MARKET_JOBS, type MarketJob, createBoss, runMarketJob } from "../packages/api/src/lib/market/worker";

const {
  positionals: [name],
  values,
} = parseArgs({
  allowPositionals: true,
  options: {
    date: { type: "string" },
    source: { type: "string" },
    enqueue: { type: "boolean", default: false },
  },
});

if (!MARKET_JOBS.includes(name as MarketJob)) {
  console.error(`Usage: pnpm market:job <job> [--date YYYY-MM-DD] [--source ecb] [--enqueue]
Jobs: ${MARKET_JOBS.join(", ")}`);
  process.exit(1);
}
const job = name as MarketJob;
const data = { ...(values.date && { day: values.date }), ...(values.source && { source: values.source }) };

if (values.enqueue) {
  // The worker env (and its Tigris vars) loads only on the run path below: enqueueing needs the
  // database alone, and the worker uses its own secrets.
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set (apps/server/.env, or scripts/with-prod-db.sh for prod)");
    process.exit(1);
  }
  // A client only: the worker owns scheduling, maintenance and the schema.
  const boss = createBoss(url, { supervise: false, schedule: false, migrate: false });
  await boss.start();
  console.log(`Enqueued ${job}:`, await boss.send(job, data));
  await boss.stop();
} else {
  const { marketDeps } = await import("../packages/api/src/lib/market/deps");
  console.log(`${job}:`, await runMarketJob(job, marketDeps(), data));
}
process.exit(0);
