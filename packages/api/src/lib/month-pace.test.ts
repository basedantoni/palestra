import { describe, expect, it } from "vitest";

import type { SpendTransaction } from "./budget-spend";
import { cumulativeByDay, elapsedDays, overUnder, pacePoints } from "./month-pace";

const row = (date: string, amount: number, over: Partial<SpendTransaction> = {}): SpendTransaction => ({
  categoryId: "groceries",
  amount,
  flow: "expense",
  excluded: false,
  date: new Date(`${date}T00:00:00.000Z`),
  ...over,
});

describe("pacePoints", () => {
  it("runs straight from $0 on day 1 to the Total Budget on the last day", () => {
    const pace = pacePoints(31, 3000);
    expect(pace).toHaveLength(31);
    expect(pace[0]).toBe(0);
    expect(pace[15]).toBe(1500);
    expect(pace[30]).toBe(3000);
  });

  it("reaches the Total Budget on day 28 of a short month", () => {
    const pace = pacePoints(28, 270);
    expect(pace).toHaveLength(28);
    expect(pace[1]).toBe(10);
    expect(pace[27]).toBe(270);
  });

  it("stays flat at $0 for a zero budget", () => {
    expect(pacePoints(30, 0)).toEqual(Array(30).fill(0));
  });
});

describe("cumulativeByDay", () => {
  it("adds each day's Budgeted Spend to the running total, one entry per day of the Month", () => {
    const days = cumulativeByDay([row("2026-09-01", 10), row("2026-09-03", 5.1), row("2026-09-03", 0.2)], "2026-09");
    expect(days).toHaveLength(30);
    expect(days.slice(0, 4)).toEqual([10, 10, 15.3, 15.3]);
    expect(days[29]).toBe(15.3);
  });

  it("lowers the cumulative on a refund", () => {
    const days = cumulativeByDay([row("2026-09-01", 40), row("2026-09-02", -15)], "2026-09");
    expect(days.slice(0, 2)).toEqual([40, 25]);
  });

  it("leaves out rows that don't count, Uncategorized spend, non-expenses and other months", () => {
    const days = cumulativeByDay(
      [
        row("2026-09-01", 10),
        row("2026-09-01", 100, { excluded: true }),
        row("2026-09-01", 100, { categoryId: null }),
        row("2026-09-01", 100, { flow: "income" }),
        row("2026-09-01", 100, { flow: "transfer" }),
        row("2026-08-31", 100),
        row("2026-10-01", 100),
      ],
      "2026-09",
    );
    expect(days[29]).toBe(10);
  });

  it("covers 28 days of a short February", () => {
    const days = cumulativeByDay([row("2026-02-28", 7)], "2026-02");
    expect(days).toHaveLength(28);
    expect(days[27]).toBe(7);
  });
});

describe("elapsedDays", () => {
  it("counts up to today in the current Month", () => {
    expect(elapsedDays("2026-10", "2026-10-26")).toBe(26);
  });

  it("counts the whole of a past Month and none of a future one", () => {
    expect(elapsedDays("2026-02", "2026-10-26")).toBe(28);
    expect(elapsedDays("2026-11", "2026-10-26")).toBe(0);
  });
});

describe("overUnder", () => {
  const pace = pacePoints(30, 290); // $10 a day after day 1

  it("is the cumulative minus Pace on the last elapsed day: positive over, negative under", () => {
    expect(overUnder([0, 25, 25], pace, 3)).toBe(5);
    expect(overUnder([0, 5, 12.5], pace, 3)).toBe(-7.5);
  });

  it("goes under after a refund pulls the cumulative down", () => {
    expect(overUnder([40, 15], pace, 2)).toBe(5);
    expect(overUnder([40, 5], pace, 2)).toBe(-5);
  });

  it("is the whole cumulative against a zero budget", () => {
    expect(overUnder([0, 12], pacePoints(30, 0), 2)).toBe(12);
  });

  it("is null before the Month starts", () => {
    expect(overUnder(Array(30).fill(0), pace, 0)).toBeNull();
  });
});
