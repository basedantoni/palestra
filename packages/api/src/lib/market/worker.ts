/**
 * The Market Watch jobs on pg-boss (KOI-364, ADR 0008), shared by the `palestra-worker` entry point
 * and the local CLI. pg-boss owns the `pgboss` schema and creates or migrates it on start.
 */
import { todayInTimeZone } from "@life-tracker/shared";
import { type ConstructorOptions, PgBoss, type Queue } from "pg-boss";
import { z } from "zod";

import { notifyAdmins } from "../admins";
import { captureFailed, guardDatabaseSize } from "./alerts";
import {
  MARKET_SOURCES,
  type MarketDeps,
  type MarketSource,
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

/** A job's collaborators: the capture's, plus who to alert (`ADMIN_EMAILS`) and the database-size probe. */
export type WorkerDeps = MarketDeps & { adminEmails: string[]; databaseSize: () => Promise<number> };

/**
 * The attempt being run: when its job was created, the clock, and pg-boss's retry counters. The
 * local CLI passes no counters, so its failures alert nobody.
 */
export type Attempt = { createdOn?: Date; now?: Date; retryCount?: number; retryLimit?: number };

/** Whether pg-boss fails the job, rather than retrying it, when this attempt throws. */
const isFinal = ({ retryCount = 0, retryLimit }: Attempt) => retryLimit !== undefined && retryCount >= retryLimit;

/** A capture's day: `--date` when given, else the UTC day the job was created (the schedule sends no data). */
const captureDay = (data: unknown, createdOn: Date) =>
  z.object({ day: isoDay.optional() }).nullish().parse(data)?.day ?? todayInTimeZone(createdOn, "UTC");

/**
 * A daily capture of a source's live response. When the last retry fails too, the day has no
 * capture, so every admin is notified.
 */
const liveCapture = (source: MarketSource, capture: (deps: WorkerDeps, day: string) => Promise<unknown>) => ({
  queue: CAPTURE_QUEUE,
  scheduled: true,
  run: async (deps: WorkerDeps, data: unknown, { createdOn = new Date(), now = new Date(), ...retries }: Attempt) => {
    const day = captureDay(data, createdOn);
    try {
      // The live response is today's: once the capture day has ended in UTC, an attempt (a late
      // retry, a stale enqueue) fails instead of landing it under the wrong day, and further retries
      // fail the same way, so the job ends failed rather than silently expiring.
      if (todayInTimeZone(now, "UTC") > day) {
        throw new Error(`market.${source}: capture window for ${day} closed at 00:00 UTC; replay with market.derive`);
      }
      return await capture(deps, day);
    } catch (err) {
      // ponytail: an attempt that pg-boss expires (15 min) or loses to a crash never reaches this
      // catch, so that final failure sends nothing. A dead-letter queue would catch it, but its
      // copied job carries no day for a scheduled run.
      if (isFinal(retries)) await notifyAdmins(deps.db, deps.adminEmails, captureFailed(source, day, err));
      throw err;
    }
  },
});

/** Job name → queue options, whether it is scheduled, and its handler. */
const JOBS = {
  "market.ecb": liveCapture("ecb", async (deps, day) => {
    const result = await captureEcb(deps, day);
    // The size guard rides on the daily ECB run, once it has landed: one check (and at most one
    // notification) a day, however many retries the capture took.
    await guardDatabaseSize(deps);
    return result;
  }),
  "market.tcgcsv": liveCapture("tcgcsv", captureTcgcsv),
  "market.derive": {
    queue: MANUAL_QUEUE,
    scheduled: false,
    run: (deps: WorkerDeps, data: unknown) =>
      deriveMarketDay(deps, z.object({ source: z.enum(MARKET_SOURCES), day: isoDay }).parse(data)),
  },
  "market.ecb-history": {
    queue: MANUAL_QUEUE,
    scheduled: false,
    run: (deps: WorkerDeps, data: unknown, { createdOn = new Date() }: Attempt) =>
      loadEcbHistory(deps, captureDay(data, createdOn)),
  },
} as const;

export type MarketJob = keyof typeof JOBS;
export const MARKET_JOBS = Object.keys(JOBS) as MarketJob[];

/** Run one job in this process, as the worker would (the local CLI's `run`). */
export function runMarketJob(name: MarketJob, deps: WorkerDeps, data: unknown, attempt: Attempt = {}) {
  return JOBS[name].run(deps, data, attempt);
}

/** pg-boss on the app database, in its own `pgboss` schema. */
export function createBoss(connectionString: string, options: Omit<ConstructorOptions, "connectionString"> = {}) {
  const boss = new PgBoss({ connectionString, ...options });
  boss.on("error", (err) => console.error("[pg-boss]", err));
  return boss;
}

/** Start pg-boss, create or update every queue, register the schedules, and work every job. */
export async function startWorker(boss: PgBoss, deps: WorkerDeps): Promise<void> {
  await boss.start();
  for (const name of MARKET_JOBS) {
    const { queue, scheduled } = JOBS[name];
    if (await boss.getQueue(name)) await boss.updateQueue(name, queue);
    else await boss.createQueue(name, queue);
    if (scheduled) await boss.schedule(name, CAPTURE_CRON, null, { tz: "UTC" });
    await boss.work(name, { includeMetadata: true }, async ([job]) => {
      if (!job) return;
      const result = await runMarketJob(name, deps, job.data, job);
      console.log(`[worker] ${name} ${job.id} done`, result);
      return result;
    });
  }
}
