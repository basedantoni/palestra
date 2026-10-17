import { describe, expect, it } from "vitest";

import {
  MAX_PATTERN_LENGTH,
  defaultCategoryId,
  isManualCategory,
  matchRule,
  bankCategoryRecategorizations,
  ruleRecategorizations,
  suggestPattern,
  resolveCategory,
  validatePattern,
  withCandidateRule,
} from "./category-rules";

// The user's Bank Category mapping: PFC primary → category id, or null when
// the user left it unmapped (Uncategorized).
const mapping = new Map<string, string | null>([
  ["FOOD_AND_DRINK", "cat-food"],
  ["GENERAL_MERCHANDISE", "cat-shop"],
  ["BANK_FEES", null],
]);

describe("defaultCategoryId", () => {
  it("is the category the user mapped the Bank Category to", () => {
    expect(defaultCategoryId("FOOD_AND_DRINK", mapping)).toBe("cat-food");
    expect(defaultCategoryId("GENERAL_MERCHANDISE", mapping)).toBe("cat-shop");
  });

  it("follows the mapping by id, whatever the category is called", () => {
    expect(defaultCategoryId("FOOD_AND_DRINK", new Map([["FOOD_AND_DRINK", "cat-renamed"]]))).toBe("cat-renamed");
  });

  it("is null (Uncategorized) for an unmapped Bank Category", () => {
    expect(defaultCategoryId("BANK_FEES", mapping)).toBeNull();
  });

  it("is null (Uncategorized) for an unknown or missing primary", () => {
    expect(defaultCategoryId("SOMETHING_NEW", mapping)).toBeNull();
    expect(defaultCategoryId(null, mapping)).toBeNull();
    expect(defaultCategoryId(undefined, mapping)).toBeNull();
  });

  it("is null when the user has no mapping", () => {
    expect(defaultCategoryId("FOOD_AND_DRINK", new Map())).toBeNull();
  });
});

describe("isManualCategory", () => {
  it("is not manual when the category equals the Default Category", () => {
    expect(isManualCategory("cat-food", "FOOD_AND_DRINK", mapping)).toBe(false);
  });

  it("is manual when the category differs from the Default Category", () => {
    expect(isManualCategory("cat-shop", "FOOD_AND_DRINK", mapping)).toBe(true);
  });

  it("is manual when the user cleared a category that had a default", () => {
    expect(isManualCategory(null, "FOOD_AND_DRINK", mapping)).toBe(true);
  });

  it("is not manual when there is neither a category nor a default", () => {
    expect(isManualCategory(null, "FOOD_AND_DRINK", new Map())).toBe(false);
  });

  it("treats an unknown or unmapped primary's default as no category", () => {
    expect(isManualCategory(null, "SOMETHING_NEW", mapping)).toBe(false);
    expect(isManualCategory("cat-food", "SOMETHING_NEW", mapping)).toBe(true);
    expect(isManualCategory(null, "BANK_FEES", mapping)).toBe(false);
    expect(isManualCategory("cat-shop", "BANK_FEES", mapping)).toBe(true);
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
      resolveCategory("STARBUCKS", "FOOD_AND_DRINK", [rule("r1", "starbucks", "cat-coffee")], mapping),
    ).toBe("cat-coffee");
  });

  it("falls back to the Default Category when no rule matches", () => {
    expect(
      resolveCategory("CHIPOTLE", "FOOD_AND_DRINK", [rule("r1", "starbucks", "cat-coffee")], mapping),
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
      ruleRecategorizations(rows, [], { id: "new", pattern: "kfc", categoryId: "cat-food" }, mapping),
    ).toEqual([{ id: "t1", categoryId: "cat-food" }]);
  });

  it("never touches a Manual Category with a real category", () => {
    const rows = [{ ...row("t1", "KFC", "cat-shop"), categoryOverridden: true }];
    expect(
      ruleRecategorizations(rows, [], { id: "new", pattern: "kfc", categoryId: "cat-food" }, mapping),
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
        mapping,
      ),
    ).toEqual([]);
  });

  it("returns only matched rows whose category changes", () => {
    const rows = [
      row("t1", "STARBUCKS #1", "cat-food"), // changes
      row("t2", "STARBUCKS #2", "cat-coffee"), // already right
    ];
    expect(
      ruleRecategorizations(rows, [], { id: "new", pattern: "starbucks", categoryId: "cat-coffee" }, mapping),
    ).toEqual([{ id: "t1", categoryId: "cat-coffee" }]);
  });

  it("leaves rows the rule doesn't match alone, even if a deleted rule categorized them", () => {
    const rows = [row("t1", "STARBUCKS #1", "cat-food"), row("t2", "UBER TRIP", "cat-travel")];
    expect(
      ruleRecategorizations(rows, [], { id: "new", pattern: "starbucks", categoryId: "cat-coffee" }, mapping),
    ).toEqual([{ id: "t1", categoryId: "cat-coffee" }]);
  });

  it("on edit, re-resolves rows the old pattern matched", () => {
    const rules = [rule("r1", "starbucks", "cat-coffee")];
    const rows = [row("t1", "STARBUCKS #1", "cat-coffee"), row("t2", "STARBUCKS RESERVE", "cat-coffee")];
    expect(
      ruleRecategorizations(rows, rules, { id: "r1", pattern: "starbucks reserve", categoryId: "cat-shop" }, mapping),
    ).toEqual([
      { id: "t1", categoryId: "cat-food" },
      { id: "t2", categoryId: "cat-shop" },
    ]);
  });

  it("keeps longest-pattern precedence from other rules", () => {
    const rules = [rule("r1", "amazon prime", "cat-subs")];
    const rows = [row("t1", "AMAZON PRIME*1", "cat-subs"), row("t2", "AMAZON MKTP", "cat-food")];
    expect(
      ruleRecategorizations(rows, rules, { id: "new", pattern: "amazon", categoryId: "cat-shop" }, mapping),
    ).toEqual([{ id: "t2", categoryId: "cat-shop" }]);
  });
});

describe("bankCategoryRecategorizations", () => {
  const remapped = new Map<string, string | null>([["FOOD_AND_DRINK", "cat-dining"]]);

  it("moves automatic rows to the newly mapped category", () => {
    const rows = [row("t1", "CHIPOTLE", "cat-food"), row("t2", "SWEETGREEN", "cat-dining")];
    expect(bankCategoryRecategorizations(rows, [], remapped)).toEqual([{ id: "t1", categoryId: "cat-dining" }]);
  });

  it("makes automatic rows Uncategorized when the Bank Category is unmapped", () => {
    const rows = [row("t1", "CHIPOTLE", "cat-food")];
    expect(bankCategoryRecategorizations(rows, [], new Map([["FOOD_AND_DRINK", null]]))).toEqual([
      { id: "t1", categoryId: null },
    ]);
  });

  it("lets a matching rule win over the mapping", () => {
    const rows = [row("t1", "STARBUCKS #1", "cat-coffee"), row("t2", "CHIPOTLE", "cat-food")];
    expect(bankCategoryRecategorizations(rows, [rule("r1", "starbucks", "cat-coffee")], remapped)).toEqual([
      { id: "t2", categoryId: "cat-dining" },
    ]);
  });

  it("never touches a Manual Category, blank or not", () => {
    const rows = [
      { ...row("t1", "CHIPOTLE", "cat-shop"), categoryOverridden: true },
      { ...row("t2", "CHIPOTLE", null), categoryOverridden: true },
    ];
    expect(bankCategoryRecategorizations(rows, [], remapped)).toEqual([]);
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
