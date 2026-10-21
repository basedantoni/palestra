import { describe, expect, it } from "vitest";

import type { TransactionFlow } from "./transaction-flow";
import {
  MAX_PATTERN_LENGTH,
  type MatchMode,
  fold,
  defaultCategoryId,
  isManualCategory,
  matchRule,
  bankCategoryRecategorizations,
  ruleRecategorizations,
  suggestPattern,
  resolveCategory,
  resolveFlow,
  ruleTargetsError,
  validatePattern,
  withCandidateRule,
} from "./rules";

// The user's Bank Category mapping: Bank Category → category id, or null when
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

const rule = (
  id: string,
  pattern: string,
  categoryId: string | null,
  createdAt = "2026-01-01",
  matchMode: MatchMode = "contains",
  setFlow: TransactionFlow | null = null,
) => ({ id, pattern, matchMode, categoryId, setFlow, createdAt: new Date(createdAt) });
/** A Rule that sets only a flow. */
const flowRule = (id: string, pattern: string, setFlow: TransactionFlow, createdAt = "2026-01-01", matchMode: MatchMode = "contains") =>
  rule(id, pattern, null, createdAt, matchMode, setFlow);

describe("fold", () => {
  it("drops accents and case", () => {
    expect(fold("Café CRÈME Ångström")).toBe("cafe creme angstrom");
  });
});

describe("matchRule", () => {
  it("matches a pattern contained in the name, ignoring case", () => {
    const r = rule("r1", "starbucks", "cat-food");
    expect(matchRule("SQ *STARBUCKS #123", [r], "categoryId")).toBe(r);
  });

  it("is null when nothing matches", () => {
    expect(matchRule("AMAZON MKTPLACE", [rule("r1", "starbucks", "cat-food")], "categoryId")).toBeNull();
    expect(matchRule("anything", [], "categoryId")).toBeNull();
  });

  it("prefers the longest pattern", () => {
    const short = rule("r1", "amazon", "cat-shop", "2026-05-01");
    const long = rule("r2", "amazon prime", "cat-subs", "2026-01-01");
    expect(matchRule("AMAZON PRIME*1234", [short, long], "categoryId")).toBe(long);
  });

  it("breaks length ties with the newest rule", () => {
    const older = rule("r1", "uber", "cat-travel", "2026-01-01");
    const newer = rule("r2", "eats", "cat-food", "2026-03-01");
    expect(matchRule("UBER EATS", [older, newer], "categoryId")).toBe(newer);
    expect(matchRule("UBER EATS", [newer, older], "categoryId")).toBe(newer);
  });

  it("is independent of input order when length and createdAt tie", () => {
    const a = rule("r1", "uber", "cat-travel");
    const b = rule("r2", "eats", "cat-food");
    expect(matchRule("UBER EATS", [a, b], "categoryId")).toBe(b);
    expect(matchRule("UBER EATS", [b, a], "categoryId")).toBe(b);
  });

  it("ignores accents in both modes", () => {
    const contains = rule("r1", "cafe", "cat-food");
    const exact = rule("r2", "creme brulee", "cat-food", "2026-01-01", "exact");
    expect(matchRule("CAFÉ DU MONDE", [contains], "categoryId")).toBe(contains);
    expect(matchRule("Crème Brûlée", [exact], "categoryId")).toBe(exact);
  });

  it("matches an exact rule only on the whole trimmed description", () => {
    const exact = rule("r1", "uber", "cat-travel", "2026-01-01", "exact");
    expect(matchRule("  UBER ", [exact], "categoryId")).toBe(exact);
    expect(matchRule("UBER EATS", [exact], "categoryId")).toBeNull();
  });

  it("prefers an exact rule over any contains rule, however long", () => {
    const exact = rule("r1", "uber eats", "cat-food", "2026-01-01", "exact");
    const longer = rule("r2", "uber eats", "cat-travel", "2026-05-01");
    expect(matchRule("UBER EATS", [longer, exact], "categoryId")).toBe(exact);
  });

  it("considers only the rules that set the asked-for field", () => {
    const category = rule("r1", "zelle", "cat-gifts");
    const flow = flowRule("r2", "zelle from jane", "income");
    expect(matchRule("ZELLE FROM JANE", [category, flow], "categoryId")).toBe(category);
    expect(matchRule("ZELLE FROM JANE", [category, flow], "setFlow")).toBe(flow);
    expect(matchRule("ZELLE TO BOB", [flow], "categoryId")).toBeNull();
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

  it("takes the category from another rule when the best match sets only a flow", () => {
    const rules = [rule("r1", "zelle", "cat-gifts"), flowRule("r2", "zelle from jane", "income")];
    expect(resolveCategory("ZELLE FROM JANE", "TRANSFER_IN", rules, mapping)).toBe("cat-gifts");
  });
});

describe("resolveFlow", () => {
  const free = { flowOverridden: false, transferPairId: null };

  it("uses the matching flow rule's flow over the base flow", () => {
    expect(resolveFlow("transfer", "ZELLE FROM JANE", [flowRule("r1", "zelle from jane", "income")], free)).toBe("income");
  });

  it("keeps the base flow when no flow rule matches", () => {
    expect(resolveFlow("expense", "CHIPOTLE", [flowRule("r1", "robinhood", "transfer")], free)).toBe("expense");
  });

  it("ignores rules that set only a category, even when they match better", () => {
    const rules = [flowRule("r1", "robin", "transfer"), rule("r2", "robinhood", "cat-invest")];
    expect(resolveFlow("expense", "ROBINHOOD", rules, free)).toBe("transfer");
    expect(resolveFlow("expense", "ROBINHOOD", [rules[1]!], free)).toBe("expense");
  });

  it("takes the best flow rule by the usual precedence", () => {
    const rules = [
      flowRule("r1", "zelle", "transfer"),
      flowRule("r2", "zelle from jane", "income"),
      flowRule("r3", "zelle from jane doe", "expense", "2026-01-01", "exact"),
    ];
    expect(resolveFlow("expense", "ZELLE FROM JANE SMITH", rules, free)).toBe("income");
    expect(resolveFlow("expense", "Zelle from Jane Doe", rules, free)).toBe("expense");
  });

  it("never changes a hand-set flow", () => {
    const rules = [flowRule("r1", "zelle", "income")];
    expect(resolveFlow("transfer", "ZELLE", rules, { flowOverridden: true, transferPairId: null })).toBe("transfer");
  });

  it("never changes a leg of a Transfer Pair", () => {
    const rules = [flowRule("r1", "zelle", "income")];
    expect(resolveFlow("transfer", "ZELLE", rules, { flowOverridden: false, transferPairId: "pair-1" })).toBe("transfer");
  });
});

describe("ruleTargetsError", () => {
  it("accepts a category, a flow, or an expense flow with a category", () => {
    expect(ruleTargetsError(null, "cat-food")).toBeNull();
    expect(ruleTargetsError("income", null)).toBeNull();
    expect(ruleTargetsError("transfer", null)).toBeNull();
    expect(ruleTargetsError("expense", "cat-food")).toBeNull();
  });

  it("rejects a rule that sets nothing", () => {
    expect(ruleTargetsError(null, null)).toMatch(/flow, a category, or both/);
  });

  it("rejects a category on an income or transfer rule", () => {
    expect(ruleTargetsError("income", "cat-food")).toBe("Income and transfer rules set no category");
    expect(ruleTargetsError("transfer", "cat-food")).toBe("Income and transfer rules set no category");
  });
});

describe("validatePattern", () => {
  const existing = [
    { id: "r1", pattern: "Starbucks", matchMode: "contains" as const },
    { id: "r2", pattern: "uber", matchMode: "contains" as const },
    { id: "r3", pattern: "Café Rio", matchMode: "exact" as const },
  ];

  it("accepts a new pattern and returns it trimmed", () => {
    expect(validatePattern("  amazon ", "contains", existing)).toEqual({ ok: true, pattern: "amazon" });
  });

  it("rejects patterns shorter than 3 characters after trimming", () => {
    expect(validatePattern("  ab  ", "contains", existing)).toMatchObject({ ok: false });
  });

  it("rejects patterns longer than the maximum, such as a long description offered as exact", () => {
    expect(validatePattern("x".repeat(MAX_PATTERN_LENGTH + 1), "exact", existing)).toMatchObject({ ok: false });
  });

  it("rejects a duplicate in the same mode, ignoring case and accents", () => {
    expect(validatePattern("STARBUCKS", "contains", existing)).toMatchObject({ ok: false });
    expect(validatePattern("cafe rio", "exact", existing)).toMatchObject({ ok: false });
  });

  it("allows the same Pattern once per mode", () => {
    expect(validatePattern("starbucks", "exact", existing)).toEqual({ ok: true, pattern: "starbucks" });
    expect(validatePattern("Cafe Rio", "contains", existing)).toEqual({ ok: true, pattern: "Cafe Rio" });
  });

  it("allows a rule to keep its own pattern on edit", () => {
    expect(validatePattern("starbucks", "contains", existing, "r1")).toEqual({ ok: true, pattern: "starbucks" });
    expect(validatePattern("uber", "contains", existing, "r1")).toMatchObject({ ok: false });
  });
});

describe("withCandidateRule", () => {
  const existing = [rule("r1", "uber", "cat-travel", "2026-01-01"), rule("r2", "amazon", "cat-shop", "2026-02-01")];

  it("keeps a new rule's own createdAt when it has one", () => {
    const saved = new Date("2026-10-07");
    const rules = withCandidateRule(existing, { id: "new", pattern: "eats", matchMode: "contains", categoryId: "cat-food", setFlow: null, createdAt: saved });
    expect(rules.at(-1)!.createdAt).toBe(saved);
  });

  it("adds a new rule as the newest", () => {
    const rules = withCandidateRule(existing, { id: "new", pattern: "eats", matchMode: "contains", categoryId: "cat-food", setFlow: null });
    expect(rules).toHaveLength(3);
    expect(rules.at(-1)).toMatchObject({ id: "new", pattern: "eats", matchMode: "contains", categoryId: "cat-food", setFlow: null });
    expect(rules.at(-1)!.createdAt > existing[1]!.createdAt).toBe(true);
  });

  it("replaces an edited rule, keeping its createdAt", () => {
    const rules = withCandidateRule(existing, { id: "r1", pattern: "uber eats", matchMode: "contains", categoryId: "cat-food", setFlow: null });
    expect(rules).toEqual([
      { id: "r1", pattern: "uber eats", matchMode: "contains", categoryId: "cat-food", setFlow: null, createdAt: new Date("2026-01-01") },
      existing[1],
    ]);
  });
});

const row = (id: string, name: string, categoryId: string | null) => ({
  id,
  name,
  plaidCategoryPrimary: "FOOD_AND_DRINK",
  categoryId,
  flow: "expense" as TransactionFlow | null,
  flowOverridden: false,
  transferPairId: null as string | null,
});
/** A bank-classified incoming transfer, as Zelle and brokerage moves arrive. */
const transferIn = (id: string, name: string) => ({
  ...row(id, name, null),
  plaidCategoryPrimary: "TRANSFER_IN",
  flow: "transfer" as TransactionFlow | null,
});
const flowCandidate = (setFlow: TransactionFlow, pattern = "zelle from jane", id = "new") => ({
  id,
  pattern,
  matchMode: "contains" as const,
  categoryId: null,
  setFlow,
});

describe("ruleRecategorizations", () => {
  it("fills a blank Manual Category when the rule matches it, clearing the manual flag", () => {
    const rows = [{ ...row("t1", "KFC", null), categoryOverridden: true }];
    expect(
      ruleRecategorizations(rows, [], { id: "new", pattern: "kfc", matchMode: "contains", categoryId: "cat-food", setFlow: null }, mapping),
    ).toEqual([{ id: "t1", categoryId: "cat-food" }]);
  });

  it("never touches a Manual Category with a real category", () => {
    const rows = [{ ...row("t1", "KFC", "cat-shop"), categoryOverridden: true }];
    expect(
      ruleRecategorizations(rows, [], { id: "new", pattern: "kfc", matchMode: "contains", categoryId: "cat-food", setFlow: null }, mapping),
    ).toEqual([]);
  });

  it("leaves a blank Manual Category blank when no rule matches it any more", () => {
    // Editing "kfc" → "kfc express": the old pattern touched t1, but no rule matches it now.
    const rows = [{ ...row("t1", "KFC", null), categoryOverridden: true }];
    expect(
      ruleRecategorizations(
        rows,
        [rule("r1", "kfc", "cat-food")],
        { id: "r1", pattern: "kfc express", matchMode: "contains", categoryId: "cat-food", setFlow: null },
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
      ruleRecategorizations(rows, [], { id: "new", pattern: "starbucks", matchMode: "contains", categoryId: "cat-coffee", setFlow: null }, mapping),
    ).toEqual([{ id: "t1", categoryId: "cat-coffee" }]);
  });

  it("leaves rows the rule doesn't match alone, even if a deleted rule categorized them", () => {
    const rows = [row("t1", "STARBUCKS #1", "cat-food"), row("t2", "UBER TRIP", "cat-travel")];
    expect(
      ruleRecategorizations(rows, [], { id: "new", pattern: "starbucks", matchMode: "contains", categoryId: "cat-coffee", setFlow: null }, mapping),
    ).toEqual([{ id: "t1", categoryId: "cat-coffee" }]);
  });

  it("on edit, re-resolves rows the old pattern matched", () => {
    const rules = [rule("r1", "starbucks", "cat-coffee")];
    const rows = [row("t1", "STARBUCKS #1", "cat-coffee"), row("t2", "STARBUCKS RESERVE", "cat-coffee")];
    expect(
      ruleRecategorizations(rows, rules, { id: "r1", pattern: "starbucks reserve", matchMode: "contains", categoryId: "cat-shop", setFlow: null }, mapping),
    ).toEqual([
      { id: "t1", categoryId: "cat-food" },
      { id: "t2", categoryId: "cat-shop" },
    ]);
  });

  it("touches only rows an exact candidate matches whole", () => {
    const rows = [row("t1", "UBER", "cat-food"), row("t2", "UBER EATS", "cat-food")];
    expect(
      ruleRecategorizations(rows, [], { id: "new", pattern: "uber", matchMode: "exact", categoryId: "cat-travel", setFlow: null }, mapping),
    ).toEqual([{ id: "t1", categoryId: "cat-travel" }]);
  });

  it("on a switch from contains to exact, re-resolves rows the contains pattern matched", () => {
    const rules = [rule("r1", "uber", "cat-travel")];
    const rows = [row("t1", "UBER", "cat-travel"), row("t2", "UBER EATS", "cat-travel")];
    expect(
      ruleRecategorizations(rows, rules, { id: "r1", pattern: "uber", matchMode: "exact", categoryId: "cat-travel", setFlow: null }, mapping),
    ).toEqual([{ id: "t2", categoryId: "cat-food" }]);
  });

  it("sets the flow of rows a flow rule matches, leaving their category alone", () => {
    const rows = [transferIn("t1", "ZELLE FROM JANE"), transferIn("t2", "ZELLE TO BOB")];
    expect(ruleRecategorizations(rows, [], flowCandidate("income"), mapping)).toEqual([{ id: "t1", flow: "income" }]);
  });

  it("returns a row whose flow is already the rule's only if its category changes", () => {
    const rows = [{ ...transferIn("t1", "ZELLE FROM JANE"), flow: "income" as const }];
    expect(ruleRecategorizations(rows, [], flowCandidate("income"), mapping)).toEqual([]);
  });

  it("changes flow and category together when the rule sets both", () => {
    const rows = [transferIn("t1", "VENMO RENT")];
    const candidate = { id: "new", pattern: "venmo rent", matchMode: "contains" as const, categoryId: "cat-rent", setFlow: "expense" as const };
    expect(ruleRecategorizations(rows, [], candidate, mapping)).toEqual([{ id: "t1", categoryId: "cat-rent", flow: "expense" }]);
  });

  it("sets the flow of a row with a Manual Category, keeping the category", () => {
    const rows = [{ ...transferIn("t1", "VENMO RENT"), categoryId: "cat-shop", categoryOverridden: true }];
    const candidate = { id: "new", pattern: "venmo rent", matchMode: "contains" as const, categoryId: "cat-rent", setFlow: "expense" as const };
    expect(ruleRecategorizations(rows, [], candidate, mapping)).toEqual([{ id: "t1", flow: "expense" }]);
  });

  it("never changes a hand-set flow or a Transfer Pair's leg", () => {
    const rows = [
      { ...transferIn("t1", "ZELLE FROM JANE"), flowOverridden: true },
      { ...transferIn("t2", "ZELLE FROM JANE"), transferPairId: "pair-1" },
    ];
    expect(ruleRecategorizations(rows, [], flowCandidate("income"), mapping)).toEqual([]);
  });

  it("on edit, returns rows the old pattern matched to the bank's flow", () => {
    const rules = [flowRule("r1", "zelle from jane", "income")];
    const rows = [{ ...transferIn("t1", "ZELLE FROM JANE"), flow: "income" as const }];
    expect(ruleRecategorizations(rows, rules, flowCandidate("income", "zelle from jane doe", "r1"), mapping)).toEqual([
      { id: "t1", flow: "transfer" },
    ]);
  });

  it("lets a category rule and a flow rule each set their own field", () => {
    // Saving the category rule doesn't undo the income the flow rule already set.
    const rules = [flowRule("r1", "zelle from jane", "income")];
    const rows = [{ ...transferIn("t1", "ZELLE FROM JANE"), flow: "income" as const }];
    const candidate = { id: "new", pattern: "zelle", matchMode: "contains" as const, categoryId: "cat-gifts", setFlow: null };
    expect(ruleRecategorizations(rows, rules, candidate, mapping)).toEqual([{ id: "t1", categoryId: "cat-gifts" }]);
  });

  it("re-resolves only the fields the rule sets, or set before the edit", () => {
    // t1's income came from a since-deleted flow rule; a category rule leaves it be.
    const rows = [{ ...transferIn("t1", "ZELLE FROM JANE"), flow: "income" as const }];
    const categoryOnly = { id: "new", pattern: "zelle", matchMode: "contains" as const, categoryId: "cat-gifts", setFlow: null };
    expect(ruleRecategorizations(rows, [], categoryOnly, mapping)).toEqual([{ id: "t1", categoryId: "cat-gifts" }]);
    // A flow-only rule leaves a category a deleted rule set.
    const categorized = [{ ...row("t2", "ZELLE FROM JANE", "cat-old"), plaidCategoryPrimary: "TRANSFER_IN", flow: "transfer" as const }];
    expect(ruleRecategorizations(categorized, [], flowCandidate("income"), mapping)).toEqual([{ id: "t2", flow: "income" }]);
    // Editing a flow rule into a category rule still returns its rows' flow.
    const rules = [flowRule("r1", "zelle", "income")];
    const edited = { ...categoryOnly, id: "r1" };
    expect(ruleRecategorizations(rows, rules, edited, mapping)).toEqual([{ id: "t1", categoryId: "cat-gifts", flow: "transfer" }]);
  });

  it("keeps longest-pattern precedence from other rules", () => {
    const rules = [rule("r1", "amazon prime", "cat-subs")];
    const rows = [row("t1", "AMAZON PRIME*1", "cat-subs"), row("t2", "AMAZON MKTP", "cat-food")];
    expect(
      ruleRecategorizations(rows, rules, { id: "new", pattern: "amazon", matchMode: "contains", categoryId: "cat-shop", setFlow: null }, mapping),
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

  it("suggests the merchant when the description has it without accents", () => {
    expect(suggestPattern("CAFE RIO #12", "Café Rio")).toBe("Café Rio");
  });

  it("ignores whitespace around the merchant", () => {
    expect(suggestPattern("SQ *STARBUCKS #123", " Starbucks ")).toBe("Starbucks");
  });

  it("cuts a long description to a savable prefix that still matches", () => {
    const name = "X".repeat(150);
    expect(suggestPattern(name, null)).toBe("X".repeat(MAX_PATTERN_LENGTH));
  });
});
