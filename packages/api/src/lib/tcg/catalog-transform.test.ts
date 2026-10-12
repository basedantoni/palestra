import { describe, expect, it } from "vitest";

import { transformCatalog } from "./catalog-transform";
import { en, ja, packs } from "./fixtures";

const catalog = transformCatalog({ ja, en, packs });

const artwork = (variantId: string) => catalog.artworks.find((a) => a.variantId === variantId);

describe("transformCatalog", () => {
  it("derives each Artwork's variant kind from its ID and source data", () => {
    expect(artwork("OP05-119")?.variantKind).toBe("base");
    expect(artwork("OP05-119_p1")?.variantKind).toBe("parallel");
    expect(artwork("OP05-119_p2")?.variantKind).toBe("manga");
    expect(artwork("OP05-119_r1")?.variantKind).toBe("reprint");
    // A secret-rare parallel reprinted in a later product is not the set's manga.
    expect(artwork("OP05-119_p4")?.variantKind).toBe("parallel");
    // OP13's third secret-rare parallel (a red alt art) is not a manga either.
    expect(artwork("OP13-118_p3")?.variantKind).toBe("parallel");
  });

  it("merges both languages onto one Artwork per variant ID, one Printing per language", () => {
    expect(catalog.artworks.filter((a) => a.variantId === "OP05-119_p1")).toHaveLength(1);
    expect(printings("OP05-119_p1")).toEqual([
      {
        variantId: "OP05-119_p1",
        language: "ja",
        packId: "550105",
        setName: "OP-05",
        imageUrl: "https://www.onepiece-cardgame.com/images/cardlist/card/OP05-119_p1.png?260828",
      },
      {
        variantId: "OP05-119_p1",
        language: "en",
        packId: "569105",
        setName: "OP-05",
        imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP05-119_p1.png?260929",
      },
    ]);
  });

  it("keeps an Artwork found in only one language to that language", () => {
    expect(printings("OP05-119_p3").map((p) => [p.language, p.setName])).toEqual([["ja", "PRB-01"]]);
  });

  it("keeps one Printing when a language lists a variant in two packs", () => {
    expect(printings("OP07-091_p1").map((p) => p.packId)).toEqual(["569801"]);
  });

  it("makes one Card per card number with its character in both languages", () => {
    expect(catalog.cards.filter((c) => c.number === "OP05-119")).toHaveLength(1);
    expect(catalog.cards.find((c) => c.number === "OP08-119")).toEqual({
      number: "OP08-119",
      nameEn: "Kaido & Linlin",
      nameJa: "カイドウ＆リンリン",
    });
    expect(artwork("OP05-119_p2")?.cardNumber).toBe("OP05-119");
  });

  it("names a set without a code by its title", () => {
    expect(printings("OP07-091_p1")[0]?.setName).toBe("Other Product Card");
  });
});

function printings(variantId: string) {
  return catalog.printings.filter((p) => p.variantId === variantId);
}
