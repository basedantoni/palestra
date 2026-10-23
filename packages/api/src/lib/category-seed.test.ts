import { describe, expect, it } from "vitest";

import { CATEGORY_ICONS } from "@life-tracker/shared";

import { PFC_PRIMARIES, SEED_CATEGORIES, categoryNameForPfc, seedBankCategoryMapping, seedCategoryColor, seedCategoryIcon } from "./category-seed";

describe("categoryNameForPfc", () => {
  it("maps known Bank Categories to friendly seed names", () => {
    expect(categoryNameForPfc("FOOD_AND_DRINK")).toBe("Food & Drink");
    expect(categoryNameForPfc("RENT_AND_UTILITIES")).toBe("Rent & Utilities");
    expect(categoryNameForPfc("TRANSPORTATION")).toBe("Transportation");
  });

  it("leaves income and transfers unmapped: categories describe spend only (KOI-341)", () => {
    expect(categoryNameForPfc("INCOME")).toBeNull();
    expect(categoryNameForPfc("TRANSFER_IN")).toBeNull();
    expect(categoryNameForPfc("TRANSFER_OUT")).toBeNull();
  });

  it("is null (Uncategorized: no category) for null/unknown", () => {
    expect(categoryNameForPfc(null)).toBeNull();
    expect(categoryNameForPfc(undefined)).toBeNull();
    expect(categoryNameForPfc("SOMETHING_NEW")).toBeNull();
  });

  it("every spend Bank Category resolves to a name present in SEED_CATEGORIES", () => {
    const names = new Set(SEED_CATEGORIES);
    const spend = PFC_PRIMARIES.filter((p) => !["INCOME", "TRANSFER_IN", "TRANSFER_OUT"].includes(p));
    for (const primary of spend) {
      expect(names.has(categoryNameForPfc(primary)!)).toBe(true);
    }
  });

  it("SEED_CATEGORIES has no duplicates, no Uncategorized, and no Income or Transfers", () => {
    expect(new Set(SEED_CATEGORIES).size).toBe(SEED_CATEGORIES.length);
    // Uncategorized means no category (glossary), never a real one (KOI-301).
    expect(SEED_CATEGORIES).not.toContain("Uncategorized");
    expect(SEED_CATEGORIES).not.toContain("Income");
    expect(SEED_CATEGORIES).not.toContain("Transfers");
  });
});

describe("seedCategoryColor", () => {
  it("gives every seed a distinct palette color", () => {
    const colors = SEED_CATEGORIES.map(seedCategoryColor);
    expect(colors).not.toContain(null);
    expect(new Set(colors).size).toBe(SEED_CATEGORIES.length);
    expect(seedCategoryColor("Food & Drink")).toBe("blue");
  });
});

describe("seedCategoryIcon", () => {
  it("gives every seed a distinct icon from the picker's set", () => {
    const icons = SEED_CATEGORIES.map(seedCategoryIcon);
    expect(icons.every((i) => i !== null && CATEGORY_ICONS.includes(i))).toBe(true);
    expect(new Set(icons).size).toBe(SEED_CATEGORIES.length);
    expect(seedCategoryIcon("Food & Drink")).toBe("utensils");
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
  });

  it("leaves transfers unmapped even for a user with a Transfers category", () => {
    const mapping = seedBankCategoryMapping(categoryByName);
    expect(mapping.get("TRANSFER_IN")).toBeNull();
    expect(mapping.get("TRANSFER_OUT")).toBeNull();
  });

  it("leaves a Bank Category unmapped when the user has no category of its name", () => {
    expect(seedBankCategoryMapping(categoryByName).get("TRAVEL")).toBeNull();
  });
});
