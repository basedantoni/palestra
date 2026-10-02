import { describe, expect, it } from "vitest";

import { computeBudgetSpend } from "./budget-spend";

describe("computeBudgetSpend", () => {
  const txns = [
    // expenses in June
    { categoryId: "food", amount: 30, flow: "expense", excluded: false, date: new Date("2026-06-05T15:00:00Z") },
    { categoryId: "food", amount: 25, flow: "expense", excluded: false, date: new Date("2026-06-20T15:00:00Z") },
    // excluded → ignored
    { categoryId: "food", amount: 999, flow: "expense", excluded: true, date: new Date("2026-06-10T15:00:00Z") },
    // income → ignored
    { categoryId: "food", amount: -2000, flow: "income", excluded: false, date: new Date("2026-06-01T15:00:00Z") },
    // transfer → ignored
    { categoryId: "save", amount: 500, flow: "transfer", excluded: false, date: new Date("2026-06-02T15:00:00Z") },
    // different month → ignored
    { categoryId: "food", amount: 40, flow: "expense", excluded: false, date: new Date("2026-05-30T15:00:00Z") },
    // transport expense
    { categoryId: "transport", amount: 60, flow: "expense", excluded: false, date: new Date("2026-06-15T15:00:00Z") },
  ];
  const budgets = [
    { categoryId: "food", limit: 100 },
    { categoryId: "transport", limit: 50 },
  ];

  it("sums expense, non-excluded, in-month transactions per budget", () => {
    const rows = computeBudgetSpend({ transactions: txns, budgets, monthKey: "2026-06" });
    const food = rows.find((r) => r.categoryId === "food")!;
    const transport = rows.find((r) => r.categoryId === "transport")!;

    expect(food.spent).toBe(55);
    expect(food.limit).toBe(100);
    expect(food.remaining).toBe(45);
    expect(food.overspent).toBe(false);

    expect(transport.spent).toBe(60);
    expect(transport.overspent).toBe(true);
    expect(transport.remaining).toBe(-10);
  });

  it("returns spent 0 for a budget with no matching transactions", () => {
    const rows = computeBudgetSpend({
      transactions: [],
      budgets: [{ categoryId: "food", limit: 100 }],
      monthKey: "2026-06",
    });
    expect(rows[0].spent).toBe(0);
    expect(rows[0].overspent).toBe(false);
  });

  it("buckets by the bank's calendar date, not the user's timezone", () => {
    // Plaid dates are stored as UTC midnight of the posted date. Jul 1 must
    // count in July even though that instant is Jun 30 evening in Chicago.
    const firstOfMonth = [
      { categoryId: "food", amount: 50, flow: "expense", excluded: false, date: new Date("2026-07-01T00:00:00Z") },
    ] as const;
    const args = { transactions: [...firstOfMonth], budgets: [{ categoryId: "food", limit: 100 }] };

    expect(computeBudgetSpend({ ...args, monthKey: "2026-07" })[0]!.spent).toBe(50);
    expect(computeBudgetSpend({ ...args, monthKey: "2026-06" })[0]!.spent).toBe(0);
  });
});
