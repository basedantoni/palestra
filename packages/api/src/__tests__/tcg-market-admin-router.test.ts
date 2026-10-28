/**
 * The admin's unmatched Marketplace Products and manual matches (KOI-368), on a real Postgres
 * (PGlite): the list is the products with no Artwork whose method is not `manual`; a manual match
 * (or "not an Artwork") is never overwritten by a capture and applies to a past day when it is
 * replayed through the `market.derive` job from the raw copy.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@life-tracker/db", () => import("./helpers/pglite").then((m) => m.pgliteDbModule()));

import { db } from "@life-tracker/db";
import { tcgArtwork, tcgCard, tcgMarketPrice, tcgMarketplaceProduct, tcgPrinting } from "@life-tracker/db/schema/index";
import { and, eq } from "drizzle-orm";

import { rawKey } from "../lib/market/capture";
import { runMarketJob } from "../lib/market/worker";
import { appRouter } from "../routers/index";
import { memoryStore } from "./helpers/memory-store";
import { truncateAll } from "./helpers/pglite";

const PAST_DAY = "2026-10-20";
const admin = appRouter.createCaller({ session: { user: { id: "admin", email: "admin@test.internal" } } } as any);
const member = appRouter.createCaller({ session: { user: { id: "member", email: "member@test.internal" } } } as any);

const noFetch = (async () => {
  throw new Error("no network in tests");
}) as typeof globalThis.fetch;

/** The recorded TCGCSV responses (OP01, OP05, OP05 anniversary) as one landed bundle, gzipped. */
function tcgcsvRaw() {
  const dir = join(import.meta.dirname, "../lib/market/fixtures/tcgcsv");
  const json = (file: string): unknown => JSON.parse(readFileSync(join(dir, file), "utf8"));
  const ids = ["3188", "23213", "23368"];
  const bundle = {
    groups: json("groups.json"),
    products: Object.fromEntries(ids.map((id) => [id, json(`${id}-products.json`)])),
    prices: Object.fromEntries(ids.map((id) => [id, json(`${id}-prices.json`)])),
  };
  return gzipSync(JSON.stringify(bundle));
}

/** Shanks OP01-120: a base, a parallel and a manga Artwork, each with an English OP-01 Printing. */
async function seedShanks() {
  await db.insert(tcgCard).values({ number: "OP01-120", nameEn: "Shanks" });
  const artworks = [
    ["OP01-120", "base"],
    ["OP01-120_p1", "parallel"],
    ["OP01-120_p2", "manga"],
  ] as const;
  await db.insert(tcgArtwork).values(artworks.map(([variantId, variantKind]) => ({ variantId, variantKind, cardNumber: "OP01-120" })));
  await db.insert(tcgPrinting).values(
    artworks.map(([variantId]) => ({
      variantId,
      language: "en" as const,
      listId: variantId,
      packId: "569101",
      setName: "OP-01",
      imageUrl: `https://img.test/en/${variantId}.png`,
    })),
  );
}

const product = (externalId: string, values: Partial<typeof tcgMarketplaceProduct.$inferInsert> = {}) =>
  db
    .insert(tcgMarketplaceProduct)
    .values({ marketplace: "tcgplayer", externalId, name: `Product ${externalId}`, number: "OP01-120", set: "OP01", method: "rule", lastSeenOn: PAST_DAY, ...values })
    .returning()
    .then(([row]) => row!);

beforeEach(async () => {
  await truncateAll(db);
  await seedShanks();
});

describe("admin.market.unmatchedProducts", () => {
  it("lists exactly the products with no Artwork whose method is not manual", async () => {
    const unmatched = await product("454665", { name: "Shanks (Parallel)", reason: "2 candidate Artworks in OP01: OP01-120_p1, OP01-120_p2" });
    await product("454664", { variantId: "OP01-120" }); // matched by rule
    await product("1", { variantId: "OP01-120_p1", method: "manual" }); // matched by hand
    await product("2", { method: "manual" }); // "not an Artwork"

    expect(await admin.admin.market.unmatchedProducts()).toEqual([
      {
        id: unmatched.id,
        marketplace: "tcgplayer",
        externalId: "454665",
        name: "Shanks (Parallel)",
        number: "OP01-120",
        set: "OP01",
        reason: "2 candidate Artworks in OP01: OP01-120_p1, OP01-120_p2",
      },
    ]);
  });
});

/** The stored row for a TCGplayer product. */
const stored = (externalId: string) =>
  db
    .select()
    .from(tcgMarketplaceProduct)
    .where(and(eq(tcgMarketplaceProduct.marketplace, "tcgplayer"), eq(tcgMarketplaceProduct.externalId, externalId)))
    .then(([row]) => row);

/** `market.derive` for TCGCSV on `day`, through the job handler, from the raw copy landed in `store`. */
const replay = (store: ReturnType<typeof memoryStore>, day: string) =>
  runMarketJob("market.derive", { db, store, fetch: noFetch }, { source: "tcgcsv", day });

describe("admin.market.setManualMatch", () => {
  it("stores a manual match to an Artwork, or 'not an Artwork' with no variant ID", async () => {
    const shanks = await product("454665", { reason: "2 candidate Artworks" });
    const law = await product("453505", { reason: "No Artwork" });

    await admin.admin.market.setManualMatch({ id: shanks.id, variantId: "OP01-120_p1" });
    await admin.admin.market.setManualMatch({ id: law.id, variantId: null });

    expect(await stored("454665")).toMatchObject({ method: "manual", variantId: "OP01-120_p1", reason: null, matchedAt: expect.any(Date) });
    expect(await stored("453505")).toMatchObject({ method: "manual", variantId: null, reason: null });
    expect(await admin.admin.market.unmatchedProducts()).toEqual([]);
  });

  it("leaves both kinds of manual row untouched on a later capture", async () => {
    const store = memoryStore();
    await store.put(rawKey("tcgcsv", PAST_DAY), tcgcsvRaw());
    await replay(store, PAST_DAY);
    const shanks = await stored("454665"); // Shanks (Parallel): two candidates, unmatched
    const base = await stored("454664"); // Shanks: matched by rule to the base Artwork

    await admin.admin.market.setManualMatch({ id: shanks!.id, variantId: "OP01-120_p2" });
    await admin.admin.market.setManualMatch({ id: base!.id, variantId: null });
    await replay(store, PAST_DAY);

    expect(await stored("454665")).toMatchObject({ method: "manual", variantId: "OP01-120_p2" });
    expect(await stored("454664")).toMatchObject({ method: "manual", variantId: null });
  });

  it("refuses an unknown product or Artwork", async () => {
    const shanks = await product("454665");

    await expect(admin.admin.market.setManualMatch({ id: shanks.id + 1, variantId: null })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(admin.admin.market.setManualMatch({ id: shanks.id, variantId: "OP99-999" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await stored("454665")).toMatchObject({ method: "rule", variantId: null });
  });
});

describe("replaying a past day after a manual match", () => {
  it("writes Market Prices for the product's Printing on that day", async () => {
    const store = memoryStore();
    await store.put(rawKey("tcgcsv", PAST_DAY), tcgcsvRaw());
    await replay(store, PAST_DAY);
    const shanks = await stored("454665");
    expect(shanks).toMatchObject({ variantId: null, reason: "2 candidate Artworks in OP01: OP01-120_p1, OP01-120_p2" });

    await admin.admin.market.setManualMatch({ id: shanks!.id, variantId: "OP01-120_p1" });
    await replay(store, PAST_DAY);

    const prices = await db
      .select({ variantId: tcgPrinting.variantId, condition: tcgMarketPrice.condition, price: tcgMarketPrice.price, day: tcgMarketPrice.day })
      .from(tcgMarketPrice)
      .innerJoin(tcgPrinting, eq(tcgPrinting.id, tcgMarketPrice.printingId))
      .where(eq(tcgMarketPrice.marketplaceProductId, shanks!.id));
    expect(prices).toEqual([{ variantId: "OP01-120_p1", condition: "NM", price: 76.82, day: PAST_DAY }]);
  });
});

describe("access", () => {
  it("refuses a non-admin on every procedure", async () => {
    const shanks = await product("454665");

    await expect(member.admin.market.unmatchedProducts()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(member.admin.market.setManualMatch({ id: shanks.id, variantId: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await stored("454665")).toMatchObject({ method: "rule" });
  });
});
