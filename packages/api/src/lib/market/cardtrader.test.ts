import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { type CardtraderBundle, cardtraderCondition, parseCardtrader, parseCardtraderExpansions } from "./cardtrader";

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/cardtrader", name), "utf8")) as unknown;

/** Hand-built responses for OP01 and OP05 (`jp`), bundled as a capture lands them. */
const bundle: CardtraderBundle = {
  expansions: fixture("expansions.json"),
  blueprints: Object.fromEntries(["2961", "3062"].map((id) => [id, fixture(`blueprints-${id}.json`)])),
  listings: { jp: Object.fromEntries(["2961", "3062"].map((id) => [id, fixture(`products-jp-${id}.json`)])) },
};
const rates = new Map([["USD", 1.1]]);

describe("parseCardtraderExpansions", () => {
  it("keeps only One Piece's expansions", () => {
    expect(parseCardtraderExpansions(bundle.expansions)).toEqual([2961, 3062]);
  });
});

describe("parseCardtrader", () => {
  const { blueprints, skipped } = parseCardtrader(bundle, "jp", rates);
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
    const lowest = byId.get("300001")!.lowest;
    // NM: €39 Mint, $41.80 (= €38 at 1.10) and €42; the €30 signed, €31 altered and €35 graded don't count.
    expect(lowest.NM).toEqual({ price: expect.closeTo(38, 6), count: 3 });
    expect(lowest).toMatchObject({
      LP: { price: 25, count: 1 },
      MP: { price: 20, count: 1 },
      HP: { price: 14, count: 2 }, // Played €15, Heavily Played €14
      DMG: { price: 9, count: 1 },
    });
  });

  it("skips and reports a Condition it doesn't know", () => {
    expect(skipped.conditions).toEqual(["Excellent"]);
  });

  it("drops a Listing in another language", () => {
    expect(byId.get("200002")!.lowest.NM).toEqual({ price: 7.5, count: 2 });
  });

  it("skips and reports a Listing in a currency with no rate", () => {
    const { blueprints: noUsd, skipped: noRate } = parseCardtrader(bundle, "jp", new Map());
    expect(noUsd.find((b) => b.externalId === "300001")!.lowest.NM).toEqual({ price: 39, count: 2 });
    expect(noRate.currencies).toEqual(["USD"]);
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
