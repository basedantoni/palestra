import { describe, expect, it } from "vitest";

import { spendByCategory, spendHistory } from "./budget-spend";

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

    expect(spendHistory([...txns], "food", ["2026-05", "2026-06", "2026-07"])).toEqual([30, 0, 20]);
  });
});
