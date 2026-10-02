import { describe, expect, it } from "vitest";

import { cashFlow } from "./cash-flow";
import { categorySpend, type CategorySpendRow, type CategorySpendTransaction, donutSlices } from "./category-spend";

const tx = (
  date: string,
  amount: number,
  category: [string, string] | null,
  flow: CategorySpendTransaction["flow"] = "expense",
  excluded = false,
): CategorySpendTransaction => ({
  date: new Date(`${date}T00:00:00Z`),
  amount,
  flow,
  excluded,
  categoryId: category?.[0] ?? null,
  categoryName: category?.[1] ?? null,
});

const groceries: [string, string] = ["c-groc", "Groceries"];
const dining: [string, string] = ["c-dine", "Dining"];
const shopping: [string, string] = ["c-shop", "Shopping"];

describe("categorySpend", () => {
  it("totals a month's spend per category, largest first, uncategorized as its own row", () => {
    const rows = categorySpend(
      [
        tx("2026-06-02", 50, dining),
        tx("2026-06-03", 120, groceries),
        tx("2026-06-20", 30, groceries),
        tx("2026-06-21", 100, null),
        tx("2026-05-31", 999, groceries), // previous month
        tx("2026-06-05", 999, dining, "expense", true), // excluded
        tx("2026-06-06", 999, dining, "transfer"),
        tx("2026-06-01", -3000, null, "income"),
      ],
      "2026-06",
    );
    expect(rows).toEqual([
      { categoryId: "c-groc", name: "Groceries", spend: 150, share: 0.5 },
      { categoryId: null, name: "Uncategorized", spend: 100, share: 1 / 3 },
      { categoryId: "c-dine", name: "Dining", spend: 50, share: 1 / 6 },
    ]);
  });

  it("nets refunds in, so a refund month leaves a category negative and last", () => {
    const rows = categorySpend(
      [
        tx("2026-06-02", 200, groceries),
        tx("2026-06-04", 40, shopping),
        tx("2026-06-09", -90, shopping), // refund of a May purchase
        tx("2026-06-10", 25, dining),
        tx("2026-06-11", -25, dining), // fully refunded: nothing to show
      ],
      "2026-06",
    );
    expect(rows.map((r) => [r.name, r.spend])).toEqual([
      ["Groceries", 200],
      ["Shopping", -50],
    ]);
    expect(rows.map((r) => r.share)).toEqual([200 / 150, -50 / 150]);
  });

  it("has no share when the month's spend is not positive", () => {
    expect(categorySpend([tx("2026-06-09", -90, shopping)], "2026-06")).toEqual([
      { categoryId: "c-shop", name: "Shopping", spend: -90, share: null },
    ]);
  });

  it("returns no rows for a month without spend", () => {
    expect(categorySpend([tx("2026-05-09", 90, shopping)], "2026-06")).toEqual([]);
  });

  it("adds up to the month's spend in cashFlow", () => {
    const txns = [
      tx("2026-06-01", 10.1, groceries),
      tx("2026-06-02", 20.2, groceries),
      tx("2026-06-03", 0.3, null),
      tx("2026-06-04", 33.33, dining),
      tx("2026-06-05", -12.07, dining),
      tx("2026-06-06", 7.77, shopping, "expense", true),
      tx("2026-06-07", 500, null, "transfer"),
      tx("2026-06-08", 41.99, null, null),
    ];
    const total = categorySpend(txns, "2026-06").reduce((s, r) => s + r.spend, 0);
    const { months } = cashFlow(txns, { currentMonth: "2026-06", months: 1, firstMonth: "2026-06" });
    expect(Math.round(total * 100) / 100).toBe(months[0]?.spend);
    expect(months[0]?.spend).toBe(51.86);
  });
});

const row = (name: string, spend: number, categoryId: string | null = `c-${name}`): CategorySpendRow => ({
  categoryId,
  name,
  spend,
  share: null,
});

describe("donutSlices", () => {
  it("keeps the top 6 categories and folds the rest into Other", () => {
    const rows = [
      row("a", 800),
      row("b", 700),
      row("Uncategorized", 600, null),
      row("c", 500),
      row("d", 400),
      row("e", 300),
      row("f", 20),
      row("g", 10),
    ];
    expect(donutSlices(rows).map((s) => [s.name, s.spend])).toEqual([
      ["a", 800],
      ["b", 700],
      ["Uncategorized", 600],
      ["c", 500],
      ["d", 400],
      ["e", 300],
      ["Other", 30],
    ]);
  });

  it("leaves out negative categories, with no Other when nothing is left over", () => {
    expect(donutSlices([row("a", 100), row("b", 50), row("refunded", -40)])).toEqual([
      { key: "c-a", name: "a", spend: 100 },
      { key: "c-b", name: "b", spend: 50 },
    ]);
  });

  it("gives Uncategorized and Other distinct keys", () => {
    const rows = ["a", "b", "c", "d", "e", "f"].map((n, i) => row(n, 100 - i));
    const keys = donutSlices([row("Uncategorized", 200, null), ...rows]).map((s) => s.key);
    expect(keys).toEqual(["uncategorized", "c-a", "c-b", "c-c", "c-d", "c-e", "other"]);
  });
});
