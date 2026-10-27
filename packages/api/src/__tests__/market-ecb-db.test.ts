/**
 * ECB capture against a real Postgres (PGlite, KOI-364): the job handlers with a recorded ECB
 * response for fetch and an in-memory bucket for Tigris.
 *
 * - a capture lands the gzipped raw response at raw/ecb/<day>/ before deriving
 * - the derive reads the landed copy, so a replay rebuilds a day from it
 * - re-running a day replaces it: one set of rows
 * - the history load fills rates back to 1999
 * - conversions use the latest rate on or before the day
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";

import { exchangeRate } from "@life-tracker/db/schema/index";
import { asc, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { captureEcb, deriveMarketDay, loadEcbHistory, type MarketDb } from "../lib/market/capture";
import { toUsd } from "../lib/market/ecb";
import { ratesOn } from "../lib/market/exchange-rate-db";
import { memoryStore } from "./helpers/memory-store";
import { pgliteDbModule, truncateAll } from "./helpers/pglite";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "../lib/market/fixtures", name));
const DAILY = fixture("eurofxref-daily-2026-10-26.xml");
const HISTORY = fixture("eurofxref-hist.zip");

/** fetch that answers every URL with `body`, counting calls. */
function recorded(body: Buffer) {
  const calls: string[] = [];
  const fetch = (async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response(new Uint8Array(body));
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

let db: MarketDb;
beforeAll(async () => {
  ({ db } = await pgliteDbModule());
});
beforeEach(async () => {
  await truncateAll(db);
});

const ratesOnDay = (day: string) =>
  db.select().from(exchangeRate).where(eq(exchangeRate.day, day)).orderBy(asc(exchangeRate.currency));

describe("market.ecb capture", () => {
  it("lands the gzipped raw response at raw/ecb/<day>/ and derives that publish day's rates", async () => {
    const store = memoryStore();
    await captureEcb({ db, store, fetch: recorded(DAILY).fetch }, "2026-10-26");

    const landed = store.objects.get("raw/ecb/2026-10-26/eurofxref-daily.xml.gz");
    expect(landed && gunzipSync(landed).equals(DAILY)).toBe(true);

    const rows = await ratesOnDay("2026-10-26");
    expect(rows).toHaveLength(29);
    expect(rows.find((r) => r.currency === "USD")?.perEur).toBe(1.1188);
    expect(rows.find((r) => r.currency === "KRW")?.perEur).toBe(1482.72);
  });

  it("writes nothing when the raw response cannot be landed", async () => {
    const store = memoryStore();
    store.put = async () => {
      throw new Error("bucket unavailable");
    };

    await expect(captureEcb({ db, store, fetch: recorded(DAILY).fetch }, "2026-10-26")).rejects.toThrow(
      "bucket unavailable",
    );
    expect(await db.select().from(exchangeRate)).toEqual([]);
  });

  it("fails on an error response and lands nothing", async () => {
    const store = memoryStore();
    const fetch = (async () => new Response("down", { status: 503 })) as typeof globalThis.fetch;

    await expect(captureEcb({ db, store, fetch }, "2026-10-26")).rejects.toThrow(/503/);
    expect(store.objects.size).toBe(0);
  });

  it("leaves exactly one set of rows when the same day runs twice", async () => {
    const deps = { db, store: memoryStore(), fetch: recorded(DAILY).fetch };
    await captureEcb(deps, "2026-10-26");
    await captureEcb(deps, "2026-10-26");

    expect(await ratesOnDay("2026-10-26")).toHaveLength(29);
  });
});

describe("market.derive", () => {
  it("rebuilds a past day from its landed copy, not from the live source", async () => {
    const store = memoryStore();
    const live = recorded(DAILY);
    await captureEcb({ db, store, fetch: live.fetch }, "2026-10-26");

    // A corrected raw copy for the day; the derive must pick it up without fetching.
    const corrected = DAILY.toString("utf8").replace("rate='1.1188'", "rate='1.2000'");
    await store.put("raw/ecb/2026-10-26/eurofxref-daily.xml.gz", gzipSync(corrected));
    await deriveMarketDay({ db, store }, { source: "ecb", day: "2026-10-26" });

    const rows = await ratesOnDay("2026-10-26");
    expect(rows).toHaveLength(29);
    expect(rows.find((r) => r.currency === "USD")?.perEur).toBe(1.2);
    expect(live.calls).toHaveLength(1);
  });

  it("refuses a day with no landed copy", async () => {
    await expect(deriveMarketDay({ db, store: memoryStore() }, { source: "ecb", day: "2026-10-01" })).rejects.toThrow(
      /no raw ecb copy/i,
    );
  });
});

describe("ECB history load", () => {
  it("fills rates back to 1999, with CNY from 2005-04-01", async () => {
    const store = memoryStore();
    await loadEcbHistory({ db, store, fetch: recorded(HISTORY).fetch }, "2026-10-27");

    expect(store.objects.has("raw/ecb-history/2026-10-27/eurofxref-hist.zip.gz")).toBe(true);
    const first = await ratesOnDay("1999-01-04");
    expect(first.find((r) => r.currency === "USD")?.perEur).toBe(1.1789);
    expect(first.find((r) => r.currency === "CNY")).toBeUndefined();
    expect((await ratesOnDay("2005-04-01")).find((r) => r.currency === "CNY")?.perEur).toBe(10.7255);
  });
});

describe("USD conversion on a day", () => {
  beforeEach(async () => {
    await loadEcbHistory({ db, store: memoryStore(), fetch: recorded(HISTORY).fetch }, "2026-10-27");
  });

  it("uses the latest publish day on or before it: the weekend falls back to Friday", async () => {
    // Friday 2026-10-23: USD 1.1193, JPY 175.51, KRW 1482.46. Monday 2026-10-26: USD 1.1188.
    const sunday = await ratesOn(db, "2026-10-25");
    expect(toUsd(10, "EUR", sunday)).toBeCloseTo(11.193, 6);
    expect(toUsd(1000, "JPY", sunday)).toBeCloseTo(6.377414, 6);
    expect(toUsd(100_000, "KRW", sunday)).toBeCloseTo(75.50288, 5);

    expect(toUsd(10, "EUR", await ratesOn(db, "2026-10-26"))).toBeCloseTo(11.188, 6);
  });

  it("has no CNY conversion before CNY was first published", async () => {
    expect(toUsd(100, "CNY", await ratesOn(db, "2005-03-31"))).toBeNull();
    expect(toUsd(100, "CNY", await ratesOn(db, "2005-04-02"))).toBeCloseTo(12.08242, 5);
  });
});
