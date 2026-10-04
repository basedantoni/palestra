import { describe, expect, it } from "vitest";

import {
  defaultCategoryId,
  isManualCategory,
  matchRule,
  resolveCategory,
  validatePattern,
} from "./category-rules";

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

const rule = (id: string, pattern: string, categoryId: string, createdAt = "2026-01-01") => ({
  id,
  pattern,
  categoryId,
  createdAt: new Date(createdAt),
});

describe("matchRule", () => {
  it("matches a pattern contained in the name, ignoring case", () => {
    const r = rule("r1", "starbucks", "cat-food");
    expect(matchRule("SQ *STARBUCKS #123", [r])).toBe(r);
  });

  it("is null when nothing matches", () => {
    expect(matchRule("AMAZON MKTPLACE", [rule("r1", "starbucks", "cat-food")])).toBeNull();
    expect(matchRule("anything", [])).toBeNull();
  });

  it("prefers the longest pattern", () => {
    const short = rule("r1", "amazon", "cat-shop", "2026-05-01");
    const long = rule("r2", "amazon prime", "cat-subs", "2026-01-01");
    expect(matchRule("AMAZON PRIME*1234", [short, long])).toBe(long);
  });

  it("breaks length ties with the newest rule", () => {
    const older = rule("r1", "uber", "cat-travel", "2026-01-01");
    const newer = rule("r2", "eats", "cat-food", "2026-03-01");
    expect(matchRule("UBER EATS", [older, newer])).toBe(newer);
    expect(matchRule("UBER EATS", [newer, older])).toBe(newer);
  });

  it("is independent of input order when length and createdAt tie", () => {
    const a = rule("r1", "uber", "cat-travel");
    const b = rule("r2", "eats", "cat-food");
    expect(matchRule("UBER EATS", [a, b])).toBe(b);
    expect(matchRule("UBER EATS", [b, a])).toBe(b);
  });
});

describe("resolveCategory", () => {
  it("uses the matching rule's category", () => {
    expect(
      resolveCategory("STARBUCKS", "FOOD_AND_DRINK", [rule("r1", "starbucks", "cat-coffee")], categoryByName),
    ).toBe("cat-coffee");
  });

  it("falls back to the Default Category when no rule matches", () => {
    expect(
      resolveCategory("CHIPOTLE", "FOOD_AND_DRINK", [rule("r1", "starbucks", "cat-coffee")], categoryByName),
    ).toBe("cat-food");
  });
});

describe("validatePattern", () => {
  const existing = [
    { id: "r1", pattern: "Starbucks" },
    { id: "r2", pattern: "uber" },
  ];

  it("accepts a new pattern and returns it trimmed", () => {
    expect(validatePattern("  amazon ", existing)).toEqual({ ok: true, pattern: "amazon" });
  });

  it("rejects patterns shorter than 3 characters after trimming", () => {
    expect(validatePattern("  ab  ", existing)).toMatchObject({ ok: false });
  });

  it("rejects a case-insensitive duplicate", () => {
    expect(validatePattern("STARBUCKS", existing)).toMatchObject({ ok: false });
  });

  it("allows a rule to keep its own pattern on edit", () => {
    expect(validatePattern("starbucks", existing, "r1")).toEqual({ ok: true, pattern: "starbucks" });
    expect(validatePattern("uber", existing, "r1")).toMatchObject({ ok: false });
  });
});
