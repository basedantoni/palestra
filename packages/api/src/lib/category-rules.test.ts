import { describe, expect, it } from "vitest";

import {
  MAX_PATTERN_LENGTH,
  defaultCategoryId,
  isManualCategory,
  matchRule,
  ruleRecategorizations,
  suggestPattern,
  resolveCategory,
  validatePattern,
  withCandidateRule,
} from "./category-rules";

// "Uncategorized" here stands for a leftover or user-made category of that name
// (cat-user-uncat): it must never become anyone's Default Category (KOI-301).
const categoryByName = new Map([
  ["Food & Drink", "cat-food"],
  ["Shopping", "cat-shop"],
  ["Uncategorized", "cat-user-uncat"],
]);

describe("defaultCategoryId", () => {
  it("maps the Plaid primary category to the user's seeded category", () => {
    expect(defaultCategoryId("FOOD_AND_DRINK", categoryByName)).toBe("cat-food");
  });

  it("is null (Uncategorized) for an unknown or missing primary", () => {
    expect(defaultCategoryId("SOMETHING_NEW", categoryByName)).toBeNull();
    expect(defaultCategoryId(null, categoryByName)).toBeNull();
    expect(defaultCategoryId(undefined, categoryByName)).toBeNull();
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

  it("treats an unknown primary's default as no category", () => {
    expect(isManualCategory(null, "SOMETHING_NEW", categoryByName)).toBe(false);
    expect(isManualCategory("cat-user-uncat", "SOMETHING_NEW", categoryByName)).toBe(true);
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

describe("withCandidateRule", () => {
  const existing = [rule("r1", "uber", "cat-travel", "2026-01-01"), rule("r2", "amazon", "cat-shop", "2026-02-01")];

  it("keeps a new rule's own createdAt when it has one", () => {
    const saved = new Date("2026-10-07");
    const rules = withCandidateRule(existing, { id: "new", pattern: "eats", categoryId: "cat-food", createdAt: saved });
    expect(rules.at(-1)!.createdAt).toBe(saved);
  });

  it("adds a new rule as the newest", () => {
    const rules = withCandidateRule(existing, { id: "new", pattern: "eats", categoryId: "cat-food" });
    expect(rules).toHaveLength(3);
    expect(rules.at(-1)).toMatchObject({ id: "new", pattern: "eats", categoryId: "cat-food" });
    expect(rules.at(-1)!.createdAt > existing[1]!.createdAt).toBe(true);
  });

  it("replaces an edited rule, keeping its createdAt", () => {
    const rules = withCandidateRule(existing, { id: "r1", pattern: "uber eats", categoryId: "cat-food" });
    expect(rules).toEqual([
      { id: "r1", pattern: "uber eats", categoryId: "cat-food", createdAt: new Date("2026-01-01") },
      existing[1],
    ]);
  });
});

const row = (id: string, name: string, categoryId: string | null) => ({
  id,
  name,
  plaidCategoryPrimary: "FOOD_AND_DRINK",
  categoryId,
});

describe("ruleRecategorizations", () => {
  it("fills a blank Manual Category when the rule matches it, clearing the manual flag", () => {
    const rows = [{ ...row("t1", "KFC", null), categoryOverridden: true }];
    expect(
      ruleRecategorizations(rows, [], { id: "new", pattern: "kfc", categoryId: "cat-food" }, categoryByName),
    ).toEqual([{ id: "t1", categoryId: "cat-food" }]);
  });

  it("never touches a Manual Category with a real category", () => {
    const rows = [{ ...row("t1", "KFC", "cat-shop"), categoryOverridden: true }];
    expect(
      ruleRecategorizations(rows, [], { id: "new", pattern: "kfc", categoryId: "cat-food" }, categoryByName),
    ).toEqual([]);
  });

  it("leaves a blank Manual Category blank when no rule matches it any more", () => {
    // Editing "kfc" → "kfc express": the old pattern touched t1, but no rule matches it now.
    const rows = [{ ...row("t1", "KFC", null), categoryOverridden: true }];
    expect(
      ruleRecategorizations(
        rows,
        [rule("r1", "kfc", "cat-food")],
        { id: "r1", pattern: "kfc express", categoryId: "cat-food" },
        categoryByName,
      ),
    ).toEqual([]);
  });

  it("returns only matched rows whose category changes", () => {
    const rows = [
      row("t1", "STARBUCKS #1", "cat-food"), // changes
      row("t2", "STARBUCKS #2", "cat-coffee"), // already right
    ];
    expect(
      ruleRecategorizations(rows, [], { id: "new", pattern: "starbucks", categoryId: "cat-coffee" }, categoryByName),
    ).toEqual([{ id: "t1", categoryId: "cat-coffee" }]);
  });

  it("leaves rows the rule doesn't match alone, even if a deleted rule categorized them", () => {
    const rows = [row("t1", "STARBUCKS #1", "cat-food"), row("t2", "UBER TRIP", "cat-travel")];
    expect(
      ruleRecategorizations(rows, [], { id: "new", pattern: "starbucks", categoryId: "cat-coffee" }, categoryByName),
    ).toEqual([{ id: "t1", categoryId: "cat-coffee" }]);
  });

  it("on edit, re-resolves rows the old pattern matched", () => {
    const rules = [rule("r1", "starbucks", "cat-coffee")];
    const rows = [row("t1", "STARBUCKS #1", "cat-coffee"), row("t2", "STARBUCKS RESERVE", "cat-coffee")];
    expect(
      ruleRecategorizations(rows, rules, { id: "r1", pattern: "starbucks reserve", categoryId: "cat-shop" }, categoryByName),
    ).toEqual([
      { id: "t1", categoryId: "cat-food" },
      { id: "t2", categoryId: "cat-shop" },
    ]);
  });

  it("keeps longest-pattern precedence from other rules", () => {
    const rules = [rule("r1", "amazon prime", "cat-subs")];
    const rows = [row("t1", "AMAZON PRIME*1", "cat-subs"), row("t2", "AMAZON MKTP", "cat-food")];
    expect(
      ruleRecategorizations(rows, rules, { id: "new", pattern: "amazon", categoryId: "cat-shop" }, categoryByName),
    ).toEqual([{ id: "t2", categoryId: "cat-shop" }]);
  });
});

describe("suggestPattern", () => {
  it("suggests the merchant when the description contains it, ignoring case", () => {
    expect(suggestPattern("SQ *STARBUCKS #123", "Starbucks")).toBe("Starbucks");
  });

  it("falls back to the description when the merchant isn't in it", () => {
    expect(suggestPattern("SQ *SBUX 123", "Starbucks")).toBe("SQ *SBUX 123");
  });

  it("falls back to the description without a merchant", () => {
    expect(suggestPattern("ACH TRANSFER 42", null)).toBe("ACH TRANSFER 42");
  });

  it("ignores whitespace around the merchant", () => {
    expect(suggestPattern("SQ *STARBUCKS #123", " Starbucks ")).toBe("Starbucks");
  });

  it("cuts a long description to a savable prefix that still matches", () => {
    const name = "X".repeat(150);
    expect(suggestPattern(name, null)).toBe("X".repeat(MAX_PATTERN_LENGTH));
  });
});
