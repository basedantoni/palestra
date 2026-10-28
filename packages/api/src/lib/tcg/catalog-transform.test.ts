import { describe, expect, it } from "vitest";

import { catalog } from "./fixtures";

const artwork = (variantId: string) => catalog.artworks.find((a) => a.variantId === variantId);

describe("transformCatalog", () => {
  it("derives each Artwork's variant kind from its ID and source data", () => {
    expect(artwork("OP05-119")?.variantKind).toBe("base");
    expect(artwork("OP05-119_p1")?.variantKind).toBe("parallel");
    expect(artwork("OP05-119_p2")?.variantKind).toBe("manga");
    expect(artwork("OP05-119_r1")?.variantKind).toBe("reprint");
    // A secret-rare parallel reprinted in a later product is not the set's manga.
    expect(artwork("OP05-119_p3")?.variantKind).toBe("parallel");
    // OP13's third secret-rare parallel (a red alt art) is not a manga either.
    expect(artwork("OP13-118_p3")?.variantKind).toBe("parallel");
  });

  it("keeps each Artwork's rarity from its first record, Japanese first", () => {
    expect(artwork("OP05-119_p1")?.rarity).toBe("SecretRare");
    expect(artwork("OP05-119_p5")?.rarity).toBe("Special"); // the OP-09 SP
  });

  it("puts both languages' Printings of one Artwork under its Japanese variant ID", () => {
    expect(catalog.artworks.filter((a) => a.variantId === "OP05-119_p1")).toHaveLength(1);
    expect(printings("OP05-119_p1")).toEqual([
      {
        variantId: "OP05-119_p1",
        listId: "OP05-119_p1",
        language: "ja",
        packId: "550105",
        setName: "OP-05",
        imageUrl: "https://www.onepiece-cardgame.com/images/cardlist/card/OP05-119_p1.png?260828",
      },
      {
        variantId: "OP05-119_p1",
        listId: "OP05-119_p1",
        language: "en",
        packId: "569105",
        setName: "OP-05",
        imageUrl: "https://en.onepiece-cardgame.com/images/cardlist/card/OP05-119_p1.png?260929",
      },
    ]);
  });

  it("puts an English print on the Japanese Artwork it pairs with, under its own list ID", () => {
    expect(printings("OP05-119_p3").map((p) => [p.language, p.listId, p.setName])).toEqual([
      ["ja", "OP05-119_p3", "PRB-01"],
      ["en", "OP05-119_p4", "PRB-01"],
    ]);
    expect(artwork("OP05-119_p4")).toBeUndefined();
  });

  it("keeps an Artwork found only in Japanese to Japanese", () => {
    expect(printings("OP05-119_p8").map((p) => [p.language, p.setName])).toEqual([["ja", "Other Product Card"]]);
  });

  it("makes an English-only print its own Artwork, marked as English", () => {
    expect(artwork("EN-EB01-015_p2")).toEqual({
      variantId: "EN-EB01-015_p2",
      cardNumber: "EB01-015",
      variantKind: "parallel",
      rarity: "Rare",
    });
    expect(printings("EN-EB01-015_p2").map((p) => [p.language, p.listId])).toEqual([["en", "EB01-015_p2"]]);
  });

  it("gives each Artwork at most one Printing per language", () => {
    const keys = catalog.printings.map((p) => `${p.variantId}|${p.language}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps one Printing when a language lists a variant in two packs", () => {
    expect(printings("OP07-091_p1").map((p) => [p.language, p.packId])).toEqual([
      ["ja", "550901"],
      ["en", "569801"],
    ]);
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
    expect(printings("OP07-091_p1").map((p) => p.setName)).toEqual(["Promotion card", "Other Product Card"]);
  });
});

function printings(variantId: string) {
  return catalog.printings.filter((p) => p.variantId === variantId);
}
