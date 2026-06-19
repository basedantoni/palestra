import { describe, expect, it } from "vitest";

import { PFC_PRIMARIES, SEED_CATEGORIES, categoryNameForPfc } from "./category-seed";

describe("categoryNameForPfc", () => {
  it("maps known Plaid PFC primaries to friendly seed names", () => {
    expect(categoryNameForPfc("FOOD_AND_DRINK")).toBe("Food & Drink");
    expect(categoryNameForPfc("RENT_AND_UTILITIES")).toBe("Rent & Utilities");
    expect(categoryNameForPfc("TRANSPORTATION")).toBe("Transportation");
    expect(categoryNameForPfc("INCOME")).toBe("Income");
    expect(categoryNameForPfc("TRANSFER_IN")).toBe("Transfers");
    expect(categoryNameForPfc("TRANSFER_OUT")).toBe("Transfers");
  });

  it("falls back to Uncategorized for null/unknown", () => {
    expect(categoryNameForPfc(null)).toBe("Uncategorized");
    expect(categoryNameForPfc(undefined)).toBe("Uncategorized");
    expect(categoryNameForPfc("SOMETHING_NEW")).toBe("Uncategorized");
  });

  it("every Plaid PFC primary resolves to a name present in SEED_CATEGORIES", () => {
    const names = new Set(SEED_CATEGORIES);
    for (const primary of PFC_PRIMARIES) {
      expect(names.has(categoryNameForPfc(primary))).toBe(true);
    }
  });

  it("SEED_CATEGORIES has no duplicates and includes Uncategorized", () => {
    expect(new Set(SEED_CATEGORIES).size).toBe(SEED_CATEGORIES.length);
    expect(SEED_CATEGORIES).toContain("Uncategorized");
  });
});
