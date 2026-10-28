/**
 * CardTrader capture against a real Postgres (PGlite, KOI-369): the job with hand-built CardTrader
 * responses (OP01 and OP05, `jp`) for fetch, a fake clock, and an in-memory bucket for Tigris.
 *
 * - at most 1 request per second, with the token, and Listings only through the `jp` filter
 * - a capture lands the raw responses at raw/cardtrader/<day>/ before deriving
 * - the lowest EUR ask per Japanese Printing per Condition with its Listing count
 * - the tcgplayer_id tier (manual matches included), then the rule tier, else unmatched
 * - several blueprints on one Artwork: the lowest ask, the summed count
 * - re-running a day replaces CardTrader's day only
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import {
  exchangeRate,
  tcgArtwork,
  tcgCard,
  tcgMarketPrice,
  tcgMarketplaceProduct,
  tcgPrinting,
} from "@life-tracker/db/schema/index";
import { and, asc, eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { captureCardtrader, deriveMarketDay, type MarketDb } from "../lib/market/capture";
import { memoryStore } from "./helpers/memory-store";
import { pgliteDbModule, truncateAll } from "./helpers/pglite";

const DAY = "2026-10-27";
const TOKEN = "ct-test-token";
const FIXTURES = join(import.meta.dirname, "../lib/market/fixtures/cardtrader");

/** A clock whose sleep moves time on at once, so the throttle's waits cost nothing. */
function fakeClock() {
  let t = Date.parse(`${DAY}T21:17:00Z`);
  return { now: () => t, sleep: async (ms: number) => void (t += Math.max(0, ms)) };
}

/** fetch answering CardTrader URLs from the fixtures, noting when each call came by the clock. */
function recordedCardtrader(clock = fakeClock()) {
  const calls: Array<{ url: string; at: number }> = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), at: clock.now() });
    if (new Headers(init?.headers).get("authorization") !== `Bearer ${TOKEN}`) {
      return new Response("Unauthorized", { status: 401 });
    }
    const u = new URL(String(url));
    const id = u.searchParams.get("expansion_id");
    const file =
      u.pathname === "/api/v2/expansions"
        ? "expansions.json"
        : u.pathname === "/api/v2/blueprints/export"
          ? `blueprints-${id}.json`
          : `products-${u.searchParams.get("language")}-${id}.json`;
    return new Response(readFileSync(join(FIXTURES, file)));
  }) as typeof globalThis.fetch;
  return { deps: { fetch, clock, cardtraderToken: TOKEN }, calls };
}

/** Artworks for the fixture's cards: [variant ID, kind, set of its Printings]. Each has a JA and an EN Printing. */
const CATALOG = [
  ["OP01-120", "base", "OP-01"],
  ["OP01-120_p1", "parallel", "OP-01"],
  ["OP01-120_p2", "manga", "OP-01"],
  ["OP05-001", "base", "OP-05"],
  ["OP05-001_p1", "parallel", "OP-05"],
  ["OP05-001_p2", "parallel", "EB-02"],
  ["OP05-003", "base", "OP-05"],
  ["OP05-100", "base", "OP-05"],
  ["OP05-119", "base", "OP-05"],
  ["OP05-119_p1", "parallel", "OP-05"],
  ["OP05-119_p2", "manga", "OP-05"],
] as const;

async function seed() {
  const numbers = [...new Set(CATALOG.map(([v]) => v.split("_")[0]!))];
  await db.insert(tcgCard).values(numbers.map((number) => ({ number })));
  await db
    .insert(tcgArtwork)
    .values(CATALOG.map(([variantId, variantKind]) => ({ variantId, variantKind, cardNumber: variantId.split("_")[0]! })));
  await db.insert(tcgPrinting).values(
    CATALOG.flatMap(([variantId, , setName]) =>
      (["ja", "en"] as const).map((language) => ({
        variantId,
        language,
        listId: variantId,
        packId: language === "ja" ? "550000" : "569000",
        setName,
        imageUrl: `https://img.test/${language}/${variantId}.png`,
      })),
    ),
  );
  // TCGplayer products the blueprints' tcg_player_id point at: two the rule matched, one by hand.
  await db.insert(tcgMarketplaceProduct).values([
    tcgplayer("527024", "OP05-119", "rule"),
    tcgplayer("527026", "OP05-119_p2", "manual"),
    tcgplayer("454664", "OP01-120", "rule"),
  ]);
  // The latest USD rate on or before the day: Monday's, 1.10 per EUR.
  await db.insert(exchangeRate).values({ day: "2026-10-26", currency: "USD", perEur: 1.1 });
}

const tcgplayer = (externalId: string, variantId: string, method: "rule" | "manual") => ({
  marketplace: "tcgplayer" as const,
  externalId,
  name: externalId,
  number: variantId.split("_")[0]!,
  set: "OP05",
  variantId,
  method,
  lastSeenOn: "2026-10-26",
});

/** A day's prices on a Marketplace as [Artwork, language, condition, price, Listing count, supplying product]. */
const pricesOn = (day: string, marketplace: "cardtrader" | "tcgplayer" = "cardtrader") =>
  db
    .select({
      variantId: tcgPrinting.variantId,
      language: tcgPrinting.language,
      condition: tcgMarketPrice.condition,
      price: tcgMarketPrice.price,
      listingCount: tcgMarketPrice.listingCount,
      product: tcgMarketplaceProduct.externalId,
    })
    .from(tcgMarketPrice)
    .innerJoin(tcgPrinting, eq(tcgPrinting.id, tcgMarketPrice.printingId))
    .innerJoin(tcgMarketplaceProduct, eq(tcgMarketplaceProduct.id, tcgMarketPrice.marketplaceProductId))
    .where(and(eq(tcgMarketPrice.marketplace, marketplace), eq(tcgMarketPrice.day, day)))
    .orderBy(asc(tcgPrinting.variantId), asc(tcgMarketPrice.condition))
    .then((rows) => rows.map((r) => [r.variantId, r.language, r.condition, r.price, r.listingCount, r.product]));

const blueprint = (externalId: string) =>
  db
    .select()
    .from(tcgMarketplaceProduct)
    .where(and(eq(tcgMarketplaceProduct.marketplace, "cardtrader"), eq(tcgMarketplaceProduct.externalId, externalId)))
    .then(([row]) => row);

let db: MarketDb;
beforeAll(async () => {
  ({ db } = await pgliteDbModule());
});
beforeEach(async () => {
  await truncateAll(db);
  await seed();
});

describe("market.cardtrader capture", () => {
  it("asks at most once a second, with the token, and for Listings only in jp", async () => {
    const { deps, calls } = recordedCardtrader();
    await captureCardtrader({ db, store: memoryStore(), ...deps }, DAY);

    expect(calls).toHaveLength(5); // expansions, then blueprints and jp Listings for OP01 and OP05
    for (const [i, call] of calls.entries()) {
      if (i > 0) expect(call.at - calls[i - 1]!.at).toBeGreaterThanOrEqual(1000);
    }
    const listingCalls = calls.map((c) => new URL(c.url)).filter((u) => u.pathname === "/api/v2/marketplace/products");
    expect(listingCalls.map((u) => [u.searchParams.get("expansion_id"), u.searchParams.get("language")])).toEqual([
      ["2961", "jp"],
      ["3062", "jp"],
    ]);
  });

  it("lands the raw responses at raw/cardtrader/<day>/ before deriving", async () => {
    const store = memoryStore();
    await captureCardtrader({ db, store, ...recordedCardtrader().deps }, DAY);

    const landed = JSON.parse(gunzipSync(store.objects.get(`raw/cardtrader/${DAY}/cardtrader.json.gz`)!).toString("utf8"));
    expect(Object.keys(landed.blueprints)).toEqual(["2961", "3062"]);
    expect(landed.products.jp["3062"]).toEqual(JSON.parse(readFileSync(join(FIXTURES, "products-jp-3062.json"), "utf8")));
  });

  it("derives the lowest EUR ask per Japanese Printing per Condition, with its Listing count", async () => {
    const result = await captureCardtrader({ db, store: memoryStore(), ...recordedCardtrader().deps }, DAY);

    expect(await pricesOn(DAY)).toEqual([
      // Two blueprints: €7.50 ×2 (tcgplayer_id) and €7 ×1 (rule). The lowest, the summed count.
      ["OP01-120", "ja", "NM", 7, 3, "200003"],
      ["OP01-120", "ja", "LP", 5, 1, "200003"],
      ["OP05-001_p1", "ja", "NM", 12.5, 1, "300005"], // rule: the only non-base OP05-001 in OP-05
      ["OP05-001_p1", "ja", "LP", 10, 1, "300005"],
      ["OP05-003", "ja", "NM", 0.3, 1, "300006"], // its tcg_player_id is unknown: the rule tier
      ["OP05-100", "ja", "NM", 1.5, 1, "300003"],
      // $41.80 at 1.10 = €38 beats €39 and €42; graded, signed and altered Listings don't count.
      ["OP05-119", "ja", "NM", expect.closeTo(38, 4), 3, "300001"],
      ["OP05-119", "ja", "LP", 25, 1, "300001"],
      ["OP05-119", "ja", "MP", 20, 1, "300001"],
      ["OP05-119", "ja", "HP", 14, 2, "300001"],
      ["OP05-119", "ja", "DMG", 9, 1, "300001"],
      ["OP05-119_p2", "ja", "NM", 1200, 1, "300002"], // its TCGplayer product's manual match
    ]);
    expect(result).toMatchObject({ prices: 12, unmatched: 1, skipped: { conditions: ["Excellent"], currencies: [] } });
  });

  it("records each blueprint with how it was matched, and why the unmatched one has no Artwork", async () => {
    await captureCardtrader({ db, store: memoryStore(), ...recordedCardtrader().deps }, DAY);

    expect(await blueprint("300001")).toMatchObject({ method: "tcgplayer_id", variantId: "OP05-119", lastSeenOn: DAY });
    expect(await blueprint("300002")).toMatchObject({ method: "tcgplayer_id", variantId: "OP05-119_p2" });
    expect(await blueprint("300003")).toMatchObject({ method: "rule", variantId: "OP05-100", number: "OP05-100", set: "op05" });
    expect(await blueprint("200001")).toMatchObject({
      method: "rule",
      variantId: null,
      reason: "2 candidate Artworks in op01: OP01-120_p1, OP01-120_p2",
    });
    expect(await blueprint("300004")).toBeUndefined(); // DON!!
    expect(await blueprint("300007")).toBeUndefined(); // sealed
  });

  it("fails without a token and lands nothing", async () => {
    const store = memoryStore();
    const { deps } = recordedCardtrader();
    await expect(captureCardtrader({ db, store, ...deps, cardtraderToken: undefined }, DAY)).rejects.toThrow(
      /CARDTRADER_TOKEN/,
    );
    expect(store.objects.size).toBe(0);
  });
});

describe("re-running and replaying a CardTrader day", () => {
  it("replaces CardTrader's day only, leaving TCGplayer's rows untouched", async () => {
    const [tcgplayerProduct] = await db
      .select({ id: tcgMarketplaceProduct.id })
      .from(tcgMarketplaceProduct)
      .where(eq(tcgMarketplaceProduct.externalId, "527024"));
    const [en] = await db
      .select({ id: tcgPrinting.id })
      .from(tcgPrinting)
      .where(and(eq(tcgPrinting.variantId, "OP05-119"), eq(tcgPrinting.language, "en")));
    await db.insert(tcgMarketPrice).values({
      printingId: en!.id,
      marketplace: "tcgplayer",
      condition: "NM",
      day: DAY,
      price: 20.9,
      marketplaceProductId: tcgplayerProduct!.id,
    });

    const store = memoryStore();
    await captureCardtrader({ db, store, ...recordedCardtrader().deps }, DAY);
    await captureCardtrader({ db, store, ...recordedCardtrader().deps }, DAY);
    await deriveMarketDay({ db, store }, { source: "cardtrader", day: DAY });

    expect(await pricesOn(DAY)).toHaveLength(12);
    expect(await pricesOn(DAY, "tcgplayer")).toEqual([["OP05-119", "en", "NM", expect.closeTo(20.9, 4), null, "527024"]]);
  });

  it("moves a blueprint's prices to its manual match on replay", async () => {
    const store = memoryStore();
    await captureCardtrader({ db, store, ...recordedCardtrader().deps }, DAY);

    await db
      .update(tcgMarketplaceProduct)
      .set({ method: "manual", variantId: "OP01-120_p1", reason: null })
      .where(and(eq(tcgMarketplaceProduct.marketplace, "cardtrader"), eq(tcgMarketplaceProduct.externalId, "200001")));
    await deriveMarketDay({ db, store }, { source: "cardtrader", day: DAY });

    expect((await pricesOn(DAY)).filter(([v]) => v === "OP01-120_p1")).toEqual([["OP01-120_p1", "ja", "NM", 90, 1, "200001"]]);
    expect(await blueprint("200001")).toMatchObject({ method: "manual", variantId: "OP01-120_p1" });
  });
});
