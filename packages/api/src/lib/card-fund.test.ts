import { describe, expect, it } from "vitest";

import type { SpendTransaction } from "./budget-spend";
import { cardFund } from "./card-fund";

const CARDS = "cards";

const spend = (date: string, amount: number, over: Partial<SpendTransaction> = {}): SpendTransaction => ({
  categoryId: CARDS,
  amount,
  flow: "expense",
  excluded: false,
  date: new Date(`${date}T00:00:00Z`),
  ...over,
});

const limits = (...months: string[]) => months.map((monthKey) => ({ monthKey, limitAmount: 50 }));

describe("cardFund", () => {
  it("carries unspent budget forward across months", () => {
    const fund = cardFund({
      categoryIds: [CARDS],
      limits: limits("2026-08", "2026-09", "2026-10"),
      transactions: [spend("2026-08-12", 20), spend("2026-09-03", 10.5), spend("2026-10-01", 30)],
      startMonth: "2026-08",
      currentMonth: "2026-10",
    });

    expect(fund.balance).toBe(89.5);
    expect(fund.thisMonth).toEqual({ limit: 50, spent: 30 });
    expect(fund.missingMonths).toEqual([]);
  });

  it("restores the fund when a card is refunded", () => {
    const fund = cardFund({
      categoryIds: [CARDS],
      limits: limits("2026-09", "2026-10"),
      transactions: [spend("2026-09-10", 45), spend("2026-10-02", -45)],
      startMonth: "2026-09",
      currentMonth: "2026-10",
    });

    expect(fund.balance).toBe(100);
    expect(fund.thisMonth).toEqual({ limit: 50, spent: -45 });
  });

  it("adds nothing for a month with no Cards budget, and reports it", () => {
    const fund = cardFund({
      categoryIds: [CARDS],
      limits: limits("2026-08", "2026-10"),
      transactions: [spend("2026-09-15", 12)],
      startMonth: "2026-08",
      currentMonth: "2026-10",
    });

    expect(fund.balance).toBe(88);
    expect(fund.missingMonths).toEqual(["2026-09"]);
  });

  it("reports the current month as missing, with no limit, when it has no budget yet", () => {
    const fund = cardFund({
      categoryIds: [CARDS],
      limits: limits("2026-09"),
      transactions: [],
      startMonth: "2026-09",
      currentMonth: "2026-10",
    });

    expect(fund.thisMonth).toEqual({ limit: null, spent: 0 });
    expect(fund.missingMonths).toEqual(["2026-10"]);
  });

  it("ignores budgets and spend outside start..current", () => {
    const fund = cardFund({
      categoryIds: [CARDS],
      limits: limits("2026-07", "2026-09", "2026-10", "2026-11"),
      transactions: [spend("2026-08-31", 40), spend("2026-09-01", 5), spend("2026-11-01", 25)],
      startMonth: "2026-09",
      currentMonth: "2026-10",
    });

    expect(fund.balance).toBe(95);
  });

  it("is zero, with nothing missing, when the start month is in the future", () => {
    const fund = cardFund({
      categoryIds: [CARDS],
      limits: limits("2026-10", "2026-11", "2026-12"),
      transactions: [spend("2026-10-05", 20), spend("2026-11-05", 20)],
      startMonth: "2026-11",
      currentMonth: "2026-10",
    });

    expect(fund.balance).toBe(0);
    expect(fund.missingMonths).toEqual([]);
  });

  it("ignores excluded, non-expense, and other categories' transactions", () => {
    const fund = cardFund({
      categoryIds: [CARDS],
      limits: limits("2026-10"),
      transactions: [
        spend("2026-10-03", 10),
        spend("2026-10-04", 99, { excluded: true }),
        spend("2026-10-05", 200, { flow: "transfer" }),
        spend("2026-10-06", -500, { flow: "income" }),
        spend("2026-10-07", 30, { flow: null }),
        spend("2026-10-08", 15, { categoryId: "food" }),
      ],
      startMonth: "2026-10",
      currentMonth: "2026-10",
    });

    expect(fund.balance).toBe(40);
    expect(fund.thisMonth.spent).toBe(10);
  });

  it("spends the fund on the Cards category's Subcategories too", () => {
    const fund = cardFund({
      categoryIds: [CARDS, "singles"],
      limits: limits("2026-10"),
      transactions: [spend("2026-10-03", 10), spend("2026-10-04", 25, { categoryId: "singles" })],
      startMonth: "2026-10",
      currentMonth: "2026-10",
    });

    expect(fund.balance).toBe(15);
    expect(fund.thisMonth.spent).toBe(35);
  });

  it("rounds to cents", () => {
    const fund = cardFund({
      categoryIds: [CARDS],
      limits: [{ monthKey: "2026-10", limitAmount: 50 }],
      transactions: [spend("2026-10-01", 0.1), spend("2026-10-02", 0.2)],
      startMonth: "2026-10",
      currentMonth: "2026-10",
    });

    expect(fund.balance).toBe(49.7);
    expect(fund.thisMonth.spent).toBe(0.3);
  });
});
