import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { matchRule, parseTcgcsv, type TcgcsvBundle } from "./tcgcsv";

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dirname, "fixtures/tcgcsv", name), "utf8")) as unknown;

/** The recorded responses for OP01, OP05 and OP05 ANN, bundled as a capture lands them. */
const bundle: TcgcsvBundle = {
  groups: fixture("groups.json"),
  products: Object.fromEntries(["3188", "23213", "23368"].map((g) => [g, fixture(`${g}-products.json`)])),
  prices: Object.fromEntries(["3188", "23213", "23368"].map((g) => [g, fixture(`${g}-prices.json`)])),
};

describe("parseTcgcsv", () => {
  const products = parseTcgcsv(bundle);
  const byId = new Map(products.map((p) => [p.externalId, p]));

  it("drops products with no card number: sealed product and DON!!", () => {
    expect(byId.has("450087")).toBe(false); // Romance Dawn - Booster Box Case
    expect(byId.has("498734")).toBe(false); // Awakening of the New Era - Booster Box
    expect(byId.has("529792")).toBe(false); // DON!! Card (Alternate Art)
    expect(byId.has("520771")).toBe(false); // 1st Anniversary Tournament Pack
    expect(products).toHaveLength(13);
  });

  it("reads each card's number and its group's abbreviation as the set", () => {
    expect(byId.get("527022")).toEqual({
      externalId: "527022",
      name: "Enel (100)",
      number: "OP05-100",
      set: "OP05",
      tags: [],
      marketPrice: 0.54,
    });
    expect(byId.get("530887")).toMatchObject({ number: "OP05-003", set: "OP05 ANN" });
  });

  it("prefers the Normal price over Foil", () => {
    // Uta (OP01-005): Normal 0.29, Foil 0.39.
    expect(byId.get("454517")?.marketPrice).toBe(0.29);
  });

  it("keeps a null marketPrice as no price, never the lowPrice", () => {
    expect(byId.get("527026")).toMatchObject({ name: "Monkey.D.Luffy (119) (Alternate Art) (Manga)", marketPrice: null });
  });

  it("reads its tags from parentheticals, not from a number in them", () => {
    expect(byId.get("453505")).toMatchObject({ name: "Trafalgar Law (002)", tags: [] });
    expect(byId.get("454514")).toMatchObject({ name: "Trafalgar Law (002) (Parallel)", tags: ["Parallel"] });
    expect(byId.get("527043")).toMatchObject({ name: "Enel (100) (SP)", tags: ["SP"] });
  });

  it("does not treat a parenthesized card number as a tag", () => {
    const [product] = parseTcgcsv({
      ...bundle,
      products: {
        3188: {
          results: [
            {
              productId: 1,
              name: "Monkey.D.Luffy (OP01-024)",
              groupId: 3188,
              extendedData: [{ name: "Number", value: "OP01-024" }],
            },
          ],
        },
      },
      prices: {},
    });
    expect(product).toMatchObject({ tags: [], marketPrice: null });
  });

  it("rejects a response TCGCSV reports as failed", () => {
    expect(() => parseTcgcsv({ ...bundle, groups: { success: false, errors: ["down"], results: [] } })).toThrow(
      /tcgcsv/i,
    );
  });
});

/** OP01-120 Shanks in OP01, with its tags (e.g. `Shanks (Parallel)`). */
const shanks = (...tags: string[]) => ({ number: "OP01-120", set: "OP01", tags });
/** OP04-070 in OP04: TCGplayer's `Mr.3 (Galdino)`, whose Card is `Mr.3(Galdino)`. */
const galdino = (...tags: string[]) => ({ number: "OP04-070", set: "OP04", tags });

describe("matchRule", () => {
  const base = { variantId: "OP01-120", variantKind: "base" } as const;
  const parallel = { variantId: "OP01-120_p1", variantKind: "parallel" } as const;
  const manga = { variantId: "OP01-120_p2", variantKind: "manga" } as const;

  it("sends an untagged product to the base Artwork", () => {
    expect(matchRule(shanks(), [base, parallel, manga], "Shanks")).toEqual({ variantId: "OP01-120" });
  });

  it("matches a tagged product to its single other Artwork in the set", () => {
    expect(matchRule(shanks("Parallel"), [base, parallel], "Shanks")).toEqual({ variantId: "OP01-120_p1" });
  });

  it("leaves a product with several candidates unmatched, naming them", () => {
    expect(matchRule(shanks("Parallel"), [base, parallel, manga], "Shanks")).toEqual({
      reason: "2 candidate Artworks in OP01: OP01-120_p1, OP01-120_p2",
    });
  });

  it("leaves a product with no candidate unmatched", () => {
    expect(matchRule({ number: "OP05-003", set: "OP05 ANN", tags: [] }, [], null)).toEqual({
      reason: "No Artwork of OP05-003 has an English Printing in OP05 ANN",
    });
    expect(matchRule(shanks(), [parallel], "Shanks")).toEqual({
      reason: "No base Artwork of OP01-120 has an English Printing in OP01",
    });
  });

  it("does not take a parenthesized alias in the Card's name for a tag", () => {
    const candidates = [
      { variantId: "OP04-070", variantKind: "base" },
      { variantId: "OP04-070_p1", variantKind: "parallel" },
    ] as const;

    expect(matchRule(galdino("Galdino"), [...candidates], "Mr.3(Galdino)")).toEqual({ variantId: "OP04-070" });
    expect(matchRule(galdino("Galdino", "Alternate Art"), [...candidates], "Mr.3(Galdino)")).toEqual({
      variantId: "OP04-070_p1",
    });
  });
});
