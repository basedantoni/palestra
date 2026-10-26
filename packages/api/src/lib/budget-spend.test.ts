import { describe, expect, it } from "vitest";

import { categoryMonthly, rollUpSpend, spendByCategory, spendHistory, totalBudget } from "./budget-spend";

describe("spend rules", () => {
  const txns = [
    // expenses in June
    { categoryId: "food", amount: 30, flow: "expense", excluded: false, date: new Date("2026-06-05T00:00:00Z") },
    { categoryId: "food", amount: 25, flow: "expense", excluded: false, date: new Date("2026-06-20T00:00:00Z") },
    // excluded → ignored
    { categoryId: "food", amount: 999, flow: "expense", excluded: true, date: new Date("2026-06-10T00:00:00Z") },
    // income → ignored
    { categoryId: "food", amount: -2000, flow: "income", excluded: false, date: new Date("2026-06-01T00:00:00Z") },
    // transfer → ignored
    { categoryId: "save", amount: 500, flow: "transfer", excluded: false, date: new Date("2026-06-02T00:00:00Z") },
    // different month → ignored
    { categoryId: "food", amount: 40, flow: "expense", excluded: false, date: new Date("2026-05-30T00:00:00Z") },
  ] as const;

  it("counts only non-excluded expenses in the month", () => {
    expect(Object.fromEntries(spendByCategory([...txns], "2026-06"))).toEqual({ food: 55 });
  });

  it("buckets by the bank's calendar date, not the user's timezone", () => {
    // Plaid dates are stored as UTC midnight of the posted date. Jul 1 must
    // count in July even though that instant is Jun 30 evening in Chicago.
    const firstOfMonth = [
      { categoryId: "food", amount: 50, flow: "expense", excluded: false, date: new Date("2026-07-01T00:00:00Z") },
    ] as const;

    expect(spendByCategory([...firstOfMonth], "2026-07").get("food")).toBe(50);
    expect(spendByCategory([...firstOfMonth], "2026-06").get("food")).toBeUndefined();
  });
});

describe("spendByCategory", () => {
  it("sums each category's non-excluded expenses in the month, including unbudgeted ones", () => {
    const spend = spendByCategory(
      [
        { categoryId: "food", amount: 30, flow: "expense", excluded: false, date: new Date("2026-06-05T00:00:00Z") },
        { categoryId: "fun", amount: 12, flow: "expense", excluded: false, date: new Date("2026-06-07T00:00:00Z") },
        { categoryId: "fun", amount: 5, flow: "expense", excluded: true, date: new Date("2026-06-07T00:00:00Z") },
        { categoryId: null, amount: 9, flow: "expense", excluded: false, date: new Date("2026-06-07T00:00:00Z") },
        { categoryId: "food", amount: 40, flow: "expense", excluded: false, date: new Date("2026-07-01T00:00:00Z") },
      ],
      "2026-06",
    );

    expect(Object.fromEntries(spend)).toEqual({ food: 30, fun: 12 });
  });
});

describe("spendHistory", () => {
  it("returns one category's spend for each requested month, zero when none", () => {
    const txns = [
      { categoryId: "food", amount: 30, flow: "expense", excluded: false, date: new Date("2026-05-10T00:00:00Z") },
      { categoryId: "food", amount: 20, flow: "expense", excluded: false, date: new Date("2026-07-02T00:00:00Z") },
      { categoryId: "fun", amount: 99, flow: "expense", excluded: false, date: new Date("2026-07-02T00:00:00Z") },
    ] as const;

    expect(spendHistory([...txns], ["food"], ["2026-05", "2026-06", "2026-07"])).toEqual([30, 0, 20]);
  });
});

describe("rollUpSpend", () => {
  const categories = [
    { id: "fun", parentId: null },
    { id: "golf", parentId: "fun" },
    { id: "movies", parentId: "fun" },
    { id: "food", parentId: null },
  ];

  it("adds each Subcategory's spend to its parent's own", () => {
    const spent = new Map([
      ["fun", 10],
      ["golf", 120],
      ["movies", 30],
      ["food", 55],
    ]);

    expect(Object.fromEntries(rollUpSpend(spent, categories))).toEqual({
      fun: 160,
      golf: 120,
      movies: 30,
      food: 55,
    });
  });

  it("gives a parent with no spend of its own its Subcategories' spend", () => {
    expect(Object.fromEntries(rollUpSpend(new Map([["golf", 40]]), categories))).toEqual({ fun: 40, golf: 40 });
  });
});

describe("totalBudget", () => {
  const categories = [
    { id: "fun", parentId: null },
    { id: "golf", parentId: "fun" },
    { id: "food", parentId: null },
    { id: "groceries", parentId: "food" },
  ];

  it("counts a Subcategory's budget only when its parent has none that month", () => {
    // Spend is rolled up: fun's 160 already includes golf's 120.
    const budgets = [
      { categoryId: "fun", limitAmount: 200, spent: 160 },
      { categoryId: "golf", limitAmount: 150, spent: 120 },
      { categoryId: "groceries", limitAmount: 300, spent: 210 },
    ];

    expect(totalBudget(budgets, categories)).toEqual({ limitAmount: 500, spent: 370 });
  });

  it("is zero with no budgets", () => {
    expect(totalBudget([], categories)).toEqual({ limitAmount: 0, spent: 0 });
  });
});

describe("categoryMonthly", () => {
  const txns = [
    // A parent's own spend and its Subcategory's, both in August
    { categoryId: "fun", amount: 10, flow: "expense", excluded: false, date: new Date("2026-08-03T00:00:00Z") },
    { categoryId: "golf", amount: 120.5, flow: "expense", excluded: false, date: new Date("2026-08-31T00:00:00Z") },
    // the 1st of October belongs to October, not September
    { categoryId: "golf", amount: 40, flow: "expense", excluded: false, date: new Date("2026-10-01T00:00:00Z") },
    // excluded, income, and another category's spend → ignored
    { categoryId: "fun", amount: 99, flow: "expense", excluded: true, date: new Date("2026-08-03T00:00:00Z") },
    { categoryId: "fun", amount: -500, flow: "income", excluded: false, date: new Date("2026-08-03T00:00:00Z") },
    { categoryId: "food", amount: 77, flow: "expense", excluded: false, date: new Date("2026-08-03T00:00:00Z") },
    // before the window → ignored
    { categoryId: "fun", amount: 15, flow: "expense", excluded: false, date: new Date("2026-07-31T00:00:00Z") },
  ] as const;

  it("buckets the category tree's spend into the months ending at monthKey, with each month's limit", () => {
    const limits = [
      { monthKey: "2026-08", limitAmount: 100 },
      { monthKey: "2026-10", limitAmount: 150 },
    ];

    expect(categoryMonthly([...txns], ["fun", "golf"], limits, "2026-10", 3)).toEqual([
      { monthKey: "2026-08", spent: 130.5, limit: 100 },
      { monthKey: "2026-09", spent: 0, limit: null },
      { monthKey: "2026-10", spent: 40, limit: 150 },
    ]);
  });

  it("covers only the given category ids (a category without its Subcategories)", () => {
    expect(categoryMonthly([...txns], ["fun"], [], "2026-08", 1)).toEqual([{ monthKey: "2026-08", spent: 10, limit: null }]);
  });
});
