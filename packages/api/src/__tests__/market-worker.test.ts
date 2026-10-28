/**
 * The Market Watch worker booting on a real Postgres (PGlite, KOI-364): pg-boss creates its
 * `pgboss` schema, the market.ecb schedule is registered at 21:17 UTC with retries that stop at the
 * end of the capture day, and queued jobs reach their handlers.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import type { PGlite } from "@electric-sql/pglite";
import { exchangeRate } from "@life-tracker/db/schema/index";
import { sql } from "drizzle-orm";
import { PgBoss, fromPglite } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { MarketDb } from "../lib/market/capture";
import { runMarketJob, startWorker } from "../lib/market/worker";
import { memoryStore } from "./helpers/memory-store";
import { pgliteDbModule } from "./helpers/pglite";

const DAILY = readFileSync(join(import.meta.dirname, "../lib/market/fixtures/eurofxref-daily-2026-10-26.xml"));

let db: MarketDb;
let boss: PgBoss;
const store = memoryStore();
const noFetch = (async () => {
  throw new Error("no network in tests");
}) as typeof globalThis.fetch;

beforeAll(async () => {
  ({ db } = await pgliteDbModule());
  const client = (db as unknown as { $client: PGlite }).$client;
  boss = new PgBoss({ db: fromPglite(client) });
  await startWorker(boss, { db, store, fetch: noFetch });
}, 60_000);

afterAll(async () => {
  await boss?.stop({ graceful: false });
});

describe("worker boot", () => {
  it("creates the pgboss schema", async () => {
    const { rows } = (await db.execute(
      sql`select schema_name from information_schema.schemata where schema_name = 'pgboss'`,
    )) as unknown as { rows: unknown[] };
    expect(rows).toHaveLength(1);
  });

  it.each(["market.ecb", "market.tcgcsv"])("schedules %s daily at 21:17 UTC", async (name) => {
    const [schedule] = await boss.getSchedules(name);
    expect(schedule).toMatchObject({ cron: "17 21 * * *", timezone: "UTC" });
  });

  it.each(["market.ecb", "market.tcgcsv"])("retries %s 3 times with backoff", async (name) => {
    expect(await boss.getQueue(name)).toMatchObject({ retryLimit: 3, retryBackoff: true });
  });

  it("boots again on a redeploy", async () => {
    await expect(startWorker(boss, { db, store, fetch: noFetch })).resolves.toBeUndefined();
  });

  it("runs a queued market.derive through its handler", async () => {
    await store.put("raw/ecb/2026-10-26/eurofxref-daily.xml.gz", gzipSync(DAILY));
    const id = await boss.send("market.derive", { source: "ecb", day: "2026-10-26" });

    await expect
      .poll(async () => (await boss.getJobById("market.derive", id!))?.state, { timeout: 20_000, interval: 250 })
      .toBe("completed");
    expect(await db.select().from(exchangeRate)).toHaveLength(29);
  }, 30_000);
});

describe("market.ecb capture day", () => {
  const fetch = (async () => new Response(new Uint8Array(DAILY))) as typeof globalThis.fetch;
  // Created 2026-10-26 21:17 UTC (16:17 in Chicago); the scheduled job carries no data.
  const createdOn = new Date("2026-10-26T21:17:00Z");

  it("is the UTC day the scheduled job was created, even when an attempt runs later that day", async () => {
    const bucket = memoryStore();
    await runMarketJob("market.ecb", { db, store: bucket, fetch }, null, createdOn, new Date("2026-10-26T23:59:00Z"));

    expect([...bucket.objects.keys()]).toEqual(["raw/ecb/2026-10-26/eurofxref-daily.xml.gz"]);
  });

  it("stops at UTC midnight: an attempt on the next day fails without capturing", async () => {
    const bucket = memoryStore();
    const run = runMarketJob("market.ecb", { db, store: bucket, fetch }, null, createdOn, new Date("2026-10-27T00:00:00Z"));

    await expect(run).rejects.toThrow(/capture window for 2026-10-26 closed/);
    expect(bucket.objects.size).toBe(0);
  });

  it("closes market.tcgcsv's window at UTC midnight too", async () => {
    const bucket = memoryStore();
    const run = runMarketJob("market.tcgcsv", { db, store: bucket, fetch }, null, createdOn, new Date("2026-10-27T00:00:00Z"));

    await expect(run).rejects.toThrow(/market\.tcgcsv: capture window for 2026-10-26 closed/);
    expect(bucket.objects.size).toBe(0);
  });
});
