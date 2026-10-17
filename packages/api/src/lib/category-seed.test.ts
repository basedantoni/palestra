import { describe, expect, it } from "vitest";

import { PFC_PRIMARIES, SEED_CATEGORIES, categoryNameForPfc, seedBankCategoryMapping, seedCategoryColor } from "./category-seed";

describe("categoryNameForPfc", () => {
  it("maps known Bank Categories to friendly seed names", () => {
    expect(categoryNameForPfc("FOOD_AND_DRINK")).toBe("Food & Drink");
    expect(categoryNameForPfc("RENT_AND_UTILITIES")).toBe("Rent & Utilities");
    expect(categoryNameForPfc("TRANSPORTATION")).toBe("Transportation");
    expect(categoryNameForPfc("INCOME")).toBe("Income");
    expect(categoryNameForPfc("TRANSFER_IN")).toBe("Transfers");
    expect(categoryNameForPfc("TRANSFER_OUT")).toBe("Transfers");
  });

  it("is null (Uncategorized: no category) for null/unknown", () => {
    expect(categoryNameForPfc(null)).toBeNull();
    expect(categoryNameForPfc(undefined)).toBeNull();
    expect(categoryNameForPfc("SOMETHING_NEW")).toBeNull();
  });

  it("every Bank Category resolves to a name present in SEED_CATEGORIES", () => {
    const names = new Set(SEED_CATEGORIES);
    for (const primary of PFC_PRIMARIES) {
      expect(names.has(categoryNameForPfc(primary)!)).toBe(true);
    }
  });

  it("SEED_CATEGORIES has no duplicates and no Uncategorized category", () => {
    expect(new Set(SEED_CATEGORIES).size).toBe(SEED_CATEGORIES.length);
    // Uncategorized means no category (glossary), never a real one (KOI-301).
    expect(SEED_CATEGORIES).not.toContain("Uncategorized");
  });
});

describe("seedCategoryColor", () => {
  it("gives every expense seed a distinct palette color, and Income and Transfers none", () => {
    const colors = SEED_CATEGORIES.map(seedCategoryColor);
    expect(colors.slice(0, 2)).toEqual([null, null]);
    expect(colors.slice(2)).not.toContain(null);
    expect(new Set(colors.slice(2)).size).toBe(SEED_CATEGORIES.length - 2);
    expect(seedCategoryColor("Food & Drink")).toBe("blue");
  });
});

describe("seedBankCategoryMapping", () => {
  const categoryByName = new Map([
    ["Food & Drink", "cat-food"],
    ["Transfers", "cat-transfers"],
  ]);

  it("maps every Bank Category, by name, to the user's category of that name", () => {
    const mapping = seedBankCategoryMapping(categoryByName);
    expect([...mapping.keys()]).toEqual([...PFC_PRIMARIES]);
    expect(mapping.get("FOOD_AND_DRINK")).toBe("cat-food");
    expect(mapping.get("TRANSFER_IN")).toBe("cat-transfers");
    expect(mapping.get("TRANSFER_OUT")).toBe("cat-transfers");
  });

  it("leaves a Bank Category unmapped when the user has no category of its name", () => {
    expect(seedBankCategoryMapping(categoryByName).get("TRAVEL")).toBeNull();
  });
});
