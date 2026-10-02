import { describe, expect, it } from "vitest";

import { cashFlow, type CashFlowTransaction } from "./cash-flow";

const tx = (
  date: string,
  amount: number,
  flow: CashFlowTransaction["flow"],
  excluded = false,
): CashFlowTransaction => ({ date: new Date(`${date}T00:00:00Z`), amount, flow, excluded });

const june = { currentMonth: "2026-06", months: 1, firstMonth: "2026-06" };

describe("cashFlow spend", () => {
  it("sums non-excluded expenses, uncategorized included, with refunds netting in", () => {
    // Category isn't an input at all: uncategorized spend counts like any other (ADR 0002).
    const { months } = cashFlow(
      [
        tx("2026-06-03", 120, "expense"),
        tx("2026-06-10", 45.5, "expense"),
        tx("2026-06-12", -20, "expense"), // refund
        tx("2026-06-15", 999, "expense", true), // excluded
      ],
      june,
    );
    expect(months[0]?.spend).toBe(145.5);
  });
});

describe("cashFlow months", () => {
  it("returns one row per calendar month oldest first, the current month partial, quiet months as zero", () => {
    const { months } = cashFlow(
      [
        tx("2026-04-30", 10, "expense"),
        tx("2026-06-01", 30, "expense"), // UTC midnight of the 1st stays in June
        tx("2026-03-31", 99, "expense"), // before the window
      ],
      { currentMonth: "2026-06", months: 3, firstMonth: "2026-01" },
    );
    expect(months).toEqual([
      { monthKey: "2026-04", income: 0, spend: 10, net: -10, isPartial: false },
      { monthKey: "2026-05", income: 0, spend: 0, net: 0, isPartial: false },
      { monthKey: "2026-06", income: 0, spend: 30, net: -30, isPartial: true },
    ]);
  });

  it("starts at the user's first transaction month when they have less history than the window", () => {
    const { months } = cashFlow([tx("2026-05-20", -1000, "income")], {
      currentMonth: "2026-06",
      months: 6,
      firstMonth: "2026-05",
    });
    expect(months.map((m) => m.monthKey)).toEqual(["2026-05", "2026-06"]);
  });

  it("returns no months for a user with no transactions", () => {
    expect(cashFlow([], { currentMonth: "2026-06", months: 6, firstMonth: null }).months).toEqual([]);
  });
});

describe("cashFlow income and net", () => {
  it("flips Plaid's sign so income is positive, ignores transfers and unclassified rows, and nets", () => {
    const { months } = cashFlow(
      [
        tx("2026-06-01", -3000, "income"),
        tx("2026-06-15", -250, "income", true), // excluded
        tx("2026-06-05", 800, "expense"),
        tx("2026-06-06", 500, "transfer"), // card payoff leg
        tx("2026-06-06", -500, "transfer"), // other leg
        tx("2026-06-07", 70, null), // flow not yet assigned
      ],
      june,
    );
    expect(months[0]).toMatchObject({ income: 3000, spend: 800, net: 2200 });
  });
});

describe("cashFlow summary", () => {
  it("averages net and computes savings rate over the last 5 complete months, leaving out the partial month", () => {
    const { summary } = cashFlow(
      [
        tx("2026-01-10", -9000, "income"), // 6th complete month back: outside the summary
        ...["02", "03", "04", "05", "06"].map((m) => tx(`2026-${m}-01`, -2000, "income")),
        ...["02", "03", "04", "05"].map((m) => tx(`2026-${m}-15`, 1500, "expense")),
        tx("2026-06-15", 2000, "expense"),
        tx("2026-07-02", 5000, "expense"), // partial month: outside the summary
      ],
      { currentMonth: "2026-07", months: 7, firstMonth: "2026-01" },
    );
    // nets 500, 500, 500, 500, 0 → 2000 saved of 10000 income
    expect(summary).toEqual({ avgNet: 400, savingsRate: 0.2 });
  });

  it("has no savings rate when income is zero", () => {
    const { summary } = cashFlow([tx("2026-05-03", 300, "expense")], {
      currentMonth: "2026-06",
      months: 6,
      firstMonth: "2026-05",
    });
    expect(summary).toEqual({ avgNet: -300, savingsRate: null });
  });

  it("has nothing to summarize when only the partial month exists", () => {
    const { summary } = cashFlow([tx("2026-06-01", -1000, "income")], {
      currentMonth: "2026-06",
      months: 6,
      firstMonth: "2026-06",
    });
    expect(summary).toEqual({ avgNet: null, savingsRate: null });
  });
});
