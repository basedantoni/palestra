/**
 * Market Watch admin alerts against a real Postgres (PGlite, KOI-365): the job handlers with a
 * failing fetch, an in-memory bucket and a database-size probe, asserting on the notification rows.
 *
 * - a capture's final failed attempt leaves one market_capture_failed per admin, naming source and day
 * - an attempt that will be retried sends nothing
 * - admins are the users matching ADMIN_EMAILS; an email with no user is skipped
 * - market.ecb sends database_near_full only past the size limit, checked once a day on its first
 *   attempt, and a failing probe never fails the capture
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { notification, user } from "@life-tracker/db/schema/index";
import { asc } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { parseAdminEmails } from "../lib/admins";
import { DATABASE_SIZE_LIMIT, databaseSize } from "../lib/market/alerts";
import type { MarketDb } from "../lib/market/capture";
import { runMarketJob, type WorkerDeps } from "../lib/market/worker";
import { memoryStore } from "./helpers/memory-store";
import { pgliteDbModule, truncateAll } from "./helpers/pglite";

// The setup's ADMIN_EMAILS, plus an address no user has.
const ADMIN = parseAdminEmails(process.env.ADMIN_EMAILS)[0]!;
const adminEmails = [ADMIN, "nobody@test.internal"];

const DAILY = readFileSync(join(import.meta.dirname, "../lib/market/fixtures/eurofxref-daily-2026-10-26.xml"));
const down = (async () => new Response("down", { status: 503 })) as typeof globalThis.fetch;
const ok = (async () => new Response(new Uint8Array(DAILY))) as typeof globalThis.fetch;
// Created 2026-10-26 21:17 UTC; every attempt runs within the capture day.
const createdOn = new Date("2026-10-26T21:17:00Z");
const now = new Date("2026-10-26T22:00:00Z");

let db: MarketDb;
beforeAll(async () => {
  ({ db } = await pgliteDbModule());
});
beforeEach(async () => {
  await truncateAll(db);
  await db.insert(user).values([
    { id: "admin", name: "Admin", email: ADMIN },
    { id: "collector", name: "Collector", email: "collector@test.internal" },
  ]);
});

const deps = (over: Partial<WorkerDeps> = {}): WorkerDeps => ({
  db,
  store: memoryStore(),
  fetch: down,
  adminEmails,
  databaseSize: async () => 0,
  ...over,
});

const notifications = () =>
  db
    .select({ userId: notification.userId, type: notification.type, message: notification.message })
    .from(notification)
    .orderBy(asc(notification.userId));

describe("market_capture_failed", () => {
  it("notifies each admin once when the final retry fails, naming the source and day", async () => {
    const run = runMarketJob("market.tcgcsv", deps(), null, { createdOn, now, retryCount: 3, retryLimit: 3 });

    await expect(run).rejects.toThrow(/503/);
    const rows = await notifications();
    expect(rows).toEqual([{ userId: "admin", type: "market_capture_failed", message: expect.any(String) }]);
    expect(rows[0]!.message).toMatch(/tcgcsv.*2026-10-26/);
  });

  it("sends nothing for a failure pg-boss will retry, nor for the retry that then succeeds", async () => {
    const retry = runMarketJob("market.ecb", deps(), null, { createdOn, now, retryCount: 2, retryLimit: 3 });
    await expect(retry).rejects.toThrow(/503/);

    await runMarketJob("market.ecb", deps({ fetch: ok }), null, { createdOn, now, retryCount: 3, retryLimit: 3 });

    expect(await notifications()).toEqual([]);
  });

  it("notifies when the last retry runs after the capture window closed", async () => {
    const late = new Date("2026-10-27T00:05:00Z");
    const run = runMarketJob("market.ecb", deps(), null, { createdOn, now: late, retryCount: 3, retryLimit: 3 });

    await expect(run).rejects.toThrow(/capture window for 2026-10-26 closed/);
    expect(await notifications()).toEqual([
      { userId: "admin", type: "market_capture_failed", message: expect.stringMatching(/ecb.*2026-10-26/) },
    ]);
  });
});

const over = async () => 4.2 * 1024 ** 3;
/** market.ecb's first attempt, ECB answering, with `probe` reporting the database size. */
const ecbWith = (probe: () => Promise<number>) =>
  runMarketJob("market.ecb", deps({ fetch: ok, databaseSize: probe }), null, { createdOn, now });
/** An attempt of market.ecb with ECB down and the database past the limit. */
const ecbDownAttempt = (retryCount: number) =>
  runMarketJob("market.ecb", deps({ databaseSize: over }), null, { createdOn, now, retryCount, retryLimit: 3 });

describe("database_near_full", () => {
  it("is sent to each admin when market.ecb finds the database past the limit", async () => {
    await ecbWith(over);

    expect(await notifications()).toEqual([
      { userId: "admin", type: "database_near_full", message: expect.stringMatching(/4\.2 GB/) },
    ]);
  });

  it("is checked once a day, on the first attempt, even when ECB is down", async () => {
    await expect(ecbDownAttempt(0)).rejects.toThrow(/503/);
    await expect(ecbDownAttempt(1)).rejects.toThrow(/503/);

    expect((await notifications()).map((n) => n.type)).toEqual(["database_near_full"]);
  });

  it("never fails the capture when the size probe does", async () => {
    await expect(ecbWith(async () => Promise.reject(new Error("probe down")))).resolves.toBeDefined();
    expect(await notifications()).toEqual([]);
  });

  it("is not sent at the limit or under it, as this test database is", async () => {
    expect(await databaseSize(db)).toBeGreaterThan(0);
    await ecbWith(async () => DATABASE_SIZE_LIMIT);
    await ecbWith(() => databaseSize(db));

    expect(await notifications()).toEqual([]);
  });
});
