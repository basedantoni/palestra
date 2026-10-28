import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  type CardtraderBundle,
  cardtraderCondition,
  parseCardtrader,
  parseCardtraderExpansions,
  printingToCreate,
} from "./cardtrader";

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/cardtrader", name), "utf8")) as unknown;
/** A real response recorded on 2026-10-28 (see "recorded CardTrader responses"). */
const recorded = (name: string) => fixture(`recorded/${name}`);

/**
 * Scenario responses for OP01 and OP05 (`jp`, `zh-CN`, `kr`), bundled as a capture lands them.
 * They are hand-built to cover every rule (graded, signed and altered Listings, each Condition,
 * several blueprints on one Artwork), and their shape was checked against real `jp` responses on
 * 2026-10-28 (`recorded/`, below).
 */
const listingsIn = (language: string) =>
  Object.fromEntries(["2961", "3062"].map((id) => [id, fixture(`products-${language}-${id}.json`)]));
const bundle: CardtraderBundle = {
  expansions: fixture("expansions.json"),
  blueprints: Object.fromEntries(["2961", "3062"].map((id) => [id, fixture(`blueprints-${id}.json`)])),
  listings: { jp: listingsIn("jp"), "zh-CN": listingsIn("zh-CN"), kr: listingsIn("kr") },
};
const rates = new Map([["USD", 1.1]]);

describe("parseCardtraderExpansions", () => {
  it("keeps only One Piece's expansions", () => {
    expect(parseCardtraderExpansions(bundle.expansions)).toEqual([2961, 3062]);
  });
});

describe("parseCardtrader", () => {
  const { blueprints, skipped } = parseCardtrader(bundle, rates);
  const byId = new Map(blueprints.map((b) => [b.externalId, b]));

  it("drops blueprints with no collector number or with rarity DON!!", () => {
    expect(byId.has("300004")).toBe(false); // DON!!
    expect(byId.has("300007")).toBe(false); // booster box
    expect(blueprints).toHaveLength(8);
  });

  it("reads a blueprint's number, expansion code as its set, version as a tag and TCGplayer id", () => {
    expect(byId.get("300002")).toMatchObject({
      name: "Monkey.D.Luffy",
      number: "OP05-119",
      set: "op05",
      tags: ["Manga"],
      tcgPlayerId: "527026",
    });
    expect(byId.get("300003")).toMatchObject({ tags: [], tcgPlayerId: null });
  });

  it("gives the lowest EUR Listing per Condition with its Listing count, ignoring graded, signed and altered Listings", () => {
    const lowest = byId.get("300001")!.lowest.ja!;
    // NM: €39 Mint, $41.80 (= €38 at 1.10) and €42; the €30 signed, €31 altered and €35 graded don't count.
    expect(lowest.NM).toEqual({ price: expect.closeTo(38, 6), count: 3 });
    expect(lowest).toMatchObject({
      LP: { price: 25, count: 1 },
      MP: { price: 20, count: 1 },
      HP: { price: 14, count: 2 }, // Played €15, Heavily Played €14
      DMG: { price: 9, count: 1 },
    });
  });

  it("skips and reports a Condition it doesn't know, or a missing one", () => {
    expect(skipped.conditions).toEqual(["Excellent", "(none)"]);
  });

  it("drops a Listing in another language", () => {
    expect(byId.get("200002")!.lowest.ja!.NM).toEqual({ price: 7.5, count: 2 });
  });

  it("gives the zh-CN and kr Listings' lowest as Simplified Chinese and Korean", () => {
    expect(byId.get("300001")!.lowest).toMatchObject({
      zh: { NM: { price: 20, count: 2 }, LP: { price: 15, count: 1 } }, // the signed €10 doesn't count
    });
    expect(byId.get("200003")!.lowest.ko).toEqual({ NM: { price: 4, count: 1 } });
    expect(byId.get("200003")!.lowest.zh).toBeUndefined();
  });

  it("reads a day landed with only jp Listings", () => {
    const { blueprints: jpOnly } = parseCardtrader({ ...bundle, listings: { jp: bundle.listings.jp } }, rates);
    expect(jpOnly.find((b) => b.externalId === "300001")!.lowest).toEqual({ ja: expect.any(Object) });
  });

  it("skips and reports a Listing in a currency with no rate", () => {
    const { blueprints: noUsd, skipped: noRate } = parseCardtrader(bundle, new Map());
    expect(noUsd.find((b) => b.externalId === "300001")!.lowest.ja!.NM).toEqual({ price: 39, count: 2 });
    expect(noRate.currencies).toEqual(["USD"]);
  });
});

/**
 * Real responses, recorded 2026-10-28 with the self-serve token (read-only) and trimmed: two One
 * Piece expansions, OP-05's first 5 blueprints, and `jp` Listings for 3 of its blueprints. Each
 * Listing's seller (`user`) and `description` are removed. Prices came in the account's currency
 * (USD), not EUR.
 */
describe("recorded CardTrader responses", () => {
  const listings = recorded("listings-jp-3461.json") as Record<
    string,
    Array<{ blueprint_id: number; name_en: string; properties_hash: { collector_number: string; onepiece_rarity: string } }>
  >;
  // The sampled Listings' blueprints aren't among the 5 sampled blueprints, so each Listing's
  // blueprint is built from the Listing's own recorded fields.
  const ownBlueprints = Object.values(listings).map(([l]) => ({
    id: l!.blueprint_id,
    name: l!.name_en,
    version: "",
    expansion_id: 3461,
    tcg_player_id: null,
    fixed_properties: {
      collector_number: l!.properties_hash.collector_number,
      onepiece_rarity: l!.properties_hash.onepiece_rarity,
    },
  }));
  const bundle: CardtraderBundle = {
    expansions: recorded("expansions.json"),
    blueprints: { 3461: [...(recorded("blueprints-3461.json") as unknown[]), ...ownBlueprints] },
    listings: { jp: { 3461: listings } },
  };
  // 1 EUR = 1.25 USD: a $0.14 Listing is €0.112.
  const { blueprints, skipped } = parseCardtrader(bundle, new Map([["USD", 1.25]]));
  const byId = new Map(blueprints.map((b) => [b.externalId, b]));

  it("keeps the One Piece expansions (game 15)", () => {
    expect(parseCardtraderExpansions(bundle.expansions)).toEqual([3324, 3461]);
  });

  it("drops the sealed booster boxes, which have no collector number", () => {
    expect(byId.has("256557")).toBe(false);
    expect(byId.has("256558")).toBe(false);
    expect(byId.get("268446")).toMatchObject({ name: "Donquixote Rosinante", number: "OP05-022", set: "op05", tcgPlayerId: "527010" });
  });

  it("keeps a suffixed collector number as CardTrader prints it", () => {
    // No Artwork has the number OP05-002a, so the rule tier can't match it. Its tcg_player_id
    // does; failing that it waits for a manual match or the TypeSafe tier (KOI-371).
    expect(byId.get("268444")).toMatchObject({
      number: "OP05-002a",
      tags: ["002 | Alternate Art"],
      tcgPlayerId: "527008",
    });
  });

  it("converts the USD Listings to EUR before taking the lowest per Condition", () => {
    expect(byId.get("269084")!.lowest).toEqual({ ja: { NM: { price: expect.closeTo(0.112, 6), count: 3 } } }); // 3 × $0.14
    expect(byId.get("268453")!.lowest.ja).toEqual({
      NM: { price: expect.closeTo(0.448, 6), count: 1 }, // $0.56
      LP: { price: expect.closeTo(0.28, 6), count: 2 }, // $0.35 and $0.36
    });
    expect(skipped).toEqual({ conditions: [], currencies: [] });
  });
});

describe("cardtraderCondition", () => {
  it.each([
    ["Mint", "NM"],
    ["Near Mint", "NM"],
    ["Slightly Played", "LP"],
    ["Moderately Played", "MP"],
    ["Played", "HP"],
    ["Heavily Played", "HP"],
    ["Poor", "DMG"],
  ])("maps %s to %s", (condition, expected) => {
    expect(cardtraderCondition(condition)).toBe(expected);
  });

  it("has no Condition for one it doesn't know", () => {
    expect(cardtraderCondition("Excellent")).toBeNull();
    expect(cardtraderCondition(undefined)).toBeNull();
  });
});

describe("printingToCreate", () => {
  const ja = { language: "ja" as const, packId: "550109", setName: "OP-09", imageUrl: "https://img.test/ja/OP09-001.png" };
  const en = { language: "en" as const, packId: "569109", setName: "OP09", imageUrl: "https://img.test/en/OP09-001.png" };

  it("copies the Japanese Printing's pack, set and image, labelled with its language, listed by the variant ID", () => {
    expect(printingToCreate("OP09-001_p1", "ko", [en, ja])).toEqual({
      variantId: "OP09-001_p1",
      language: "ko",
      listId: "OP09-001_p1",
      packId: "550109",
      setName: "OP-09, Korean",
      imageUrl: "https://img.test/ja/OP09-001.png",
    });
  });

  it("falls back to the English Printing", () => {
    expect(printingToCreate("OP09-001", "zh", [en])).toMatchObject({
      packId: "569109",
      setName: "OP09, Simplified Chinese",
      imageUrl: "https://img.test/en/OP09-001.png",
    });
  });

  it("creates none when the Artwork has a Printing in that language, or nothing to copy", () => {
    expect(printingToCreate("OP09-001", "zh", [ja, { ...ja, language: "zh" }])).toBeNull();
    expect(printingToCreate("OP09-001", "ko", [])).toBeNull();
  });
});
