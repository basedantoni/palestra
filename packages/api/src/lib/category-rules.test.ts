import { describe, expect, it } from "vitest";

import { defaultCategoryId, isManualCategory } from "./category-rules";

const categoryByName = new Map([
  ["Food & Drink", "cat-food"],
  ["Shopping", "cat-shop"],
  ["Uncategorized", "cat-uncat"],
]);

describe("defaultCategoryId", () => {
  it("maps the Plaid primary category to the user's seeded category", () => {
    expect(defaultCategoryId("FOOD_AND_DRINK", categoryByName)).toBe("cat-food");
  });

  it("falls back to the Uncategorized seed for an unknown or missing primary", () => {
    expect(defaultCategoryId("SOMETHING_NEW", categoryByName)).toBe("cat-uncat");
    expect(defaultCategoryId(null, categoryByName)).toBe("cat-uncat");
  });

  it("is null when the user has no matching category", () => {
    expect(defaultCategoryId("FOOD_AND_DRINK", new Map())).toBeNull();
  });
});

describe("isManualCategory", () => {
  it("is not manual when the category equals the Default Category", () => {
    expect(isManualCategory("cat-food", "FOOD_AND_DRINK", categoryByName)).toBe(false);
  });

  it("is manual when the category differs from the Default Category", () => {
    expect(isManualCategory("cat-shop", "FOOD_AND_DRINK", categoryByName)).toBe(true);
  });

  it("is manual when the user cleared a category that had a default", () => {
    expect(isManualCategory(null, "FOOD_AND_DRINK", categoryByName)).toBe(true);
  });

  it("is not manual when there is neither a category nor a default", () => {
    expect(isManualCategory(null, "FOOD_AND_DRINK", new Map())).toBe(false);
  });

  it("treats an unknown primary's default as the Uncategorized seed", () => {
    expect(isManualCategory("cat-uncat", "SOMETHING_NEW", categoryByName)).toBe(false);
    expect(isManualCategory("cat-food", "SOMETHING_NEW", categoryByName)).toBe(true);
  });
});
