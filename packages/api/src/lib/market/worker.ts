/**
 * The Market Watch jobs on pg-boss (KOI-364, ADR 0008), shared by the `palestra-worker` entry point
 * and the local CLI. pg-boss owns the `pgboss` schema and creates or migrates it on start.
 */
import { todayInTimeZone } from "@life-tracker/shared";
import { type ConstructorOptions, PgBoss, type Queue } from "pg-boss";
import { z } from "zod";

import {
  MARKET_SOURCES,
  type MarketDeps,
  captureCardtrader,
  captureEcb,
  captureTcgcsv,
  deriveMarketDay,
  loadEcbHistory,
} from "./capture";

const CAPTURE_HOUR = 21;
const CAPTURE_MINUTE = 17;

/** Every daily capture runs at 21:17 UTC; the price day is the UTC day of the capture. */
export const CAPTURE_CRON = `${CAPTURE_MINUTE} ${CAPTURE_HOUR} * * *`;

/** 3 retries with backoff (about 1, 2 then 4 minutes), each attempt cut off after 15 minutes. */
const CAPTURE_QUEUE: Omit<Queue, "name"> = {
  retryLimit: 3,
  retryDelay: 60,
  retryBackoff: true,
  retryDelayMax: 600,
  expireInSeconds: 15 * 60,
};

/** Run by hand: a failure is rerun by hand, not retried. */
const MANUAL_QUEUE: Omit<Queue, "name"> = { retryLimit: 0 };

const isoDay = z.iso.date();

/** A capture's day: `--date` when given, else the UTC day the job was created (the schedule sends no data). */
const captureDay = (data: unknown, createdOn: Date) =>
  z.object({ day: isoDay.optional() }).nullish().parse(data)?.day ?? todayInTimeZone(createdOn, "UTC");

/** A daily capture of a source's live response. */
const liveCapture = (name: string, capture: (deps: MarketDeps, day: string) => Promise<unknown>) => ({
  queue: CAPTURE_QUEUE,
  scheduled: true,
  run: async (deps: MarketDeps, data: unknown, createdOn: Date, now: Date) => {
    // The live response is today's: once the capture day has ended in UTC, an attempt (a late
    // retry, a stale enqueue) fails instead of landing it under the wrong day, and further retries
    // fail the same way, so the job ends failed rather than silently expiring.
    const day = captureDay(data, createdOn);
    if (todayInTimeZone(now, "UTC") > day) {
      throw new Error(`${name}: capture window for ${day} closed at 00:00 UTC; replay with market.derive`);
    }
    return capture(deps, day);
  },
});

/** Job name → queue options, whether it is scheduled, and its handler. */
const JOBS = {
  "market.ecb": liveCapture("market.ecb", captureEcb),
  "market.tcgcsv": liveCapture("market.tcgcsv", captureTcgcsv),
  "market.cardtrader": liveCapture("market.cardtrader", captureCardtrader),
  "market.derive": {
    queue: MANUAL_QUEUE,
    scheduled: false,
    run: (deps: MarketDeps, data: unknown) =>
      deriveMarketDay(deps, z.object({ source: z.enum(MARKET_SOURCES), day: isoDay }).parse(data)),
  },
  "market.ecb-history": {
    queue: MANUAL_QUEUE,
    scheduled: false,
    run: (deps: MarketDeps, data: unknown, createdOn: Date) => loadEcbHistory(deps, captureDay(data, createdOn)),
  },
} as const;

export type MarketJob = keyof typeof JOBS;
export const MARKET_JOBS = Object.keys(JOBS) as MarketJob[];

/** Run one job in this process, as the worker would (the local CLI's `run`). */
export function runMarketJob(name: MarketJob, deps: MarketDeps, data: unknown, createdOn = new Date(), now = new Date()) {
  return JOBS[name].run(deps, data, createdOn, now);
}

/** pg-boss on the app database, in its own `pgboss` schema. */
export function createBoss(connectionString: string, options: Omit<ConstructorOptions, "connectionString"> = {}) {
  const boss = new PgBoss({ connectionString, ...options });
  boss.on("error", (err) => console.error("[pg-boss]", err));
  return boss;
}

/** Start pg-boss, create or update every queue, register the schedules, and work every job. */
export async function startWorker(boss: PgBoss, deps: MarketDeps): Promise<void> {
  await boss.start();
  for (const name of MARKET_JOBS) {
    const { queue, scheduled } = JOBS[name];
    if (await boss.getQueue(name)) await boss.updateQueue(name, queue);
    else await boss.createQueue(name, queue);
    if (scheduled) await boss.schedule(name, CAPTURE_CRON, null, { tz: "UTC" });
    await boss.work(name, { includeMetadata: true }, async ([job]) => {
      if (!job) return;
      const result = await runMarketJob(name, deps, job.data, job.createdOn);
      console.log(`[worker] ${name} ${job.id} done`, result);
      return result;
    });
  }
}
