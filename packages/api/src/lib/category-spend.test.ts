import { describe, expect, it } from "vitest";

import { resolvePeriodBounds } from "@life-tracker/shared";

import { cashFlow } from "./cash-flow";
import { type CategorySpendTransaction, categorySpendTree, type SpendCategory } from "./category-spend";

const tx = (
  date: string,
  amount: number,
  categoryId: string | null,
  flow: CategorySpendTransaction["flow"] = "expense",
  excluded = false,
): CategorySpendTransaction => ({ date: new Date(`${date}T00:00:00Z`), amount, flow, excluded, categoryId });

const cat = (id: string, name: string, extra: Partial<SpendCategory> = {}): SpendCategory => ({
  id,
  name,
  parentId: null,
  color: null,
  icon: null,
  ...extra,
});

// In manual order: Entertainment, then its Subcategories Golf and Movies.
const categories = [
  cat("groc", "Groceries", { color: "aqua", icon: "shopping-cart" }),
  cat("ent", "Entertainment", { color: "violet" }),
  cat("golf", "Golf", { parentId: "ent" }),
  cat("movies", "Movies", { parentId: "ent" }),
  cat("dine", "Dining"),
];

const today = "2026-06-20";
const june = resolvePeriodBounds({ kind: "month", month: "2026-06" }, today);

describe("categorySpendTree", () => {
  it("rolls Subcategories into their Parent Category, ranks by total, Uncategorized as its own row", () => {
    const tree = categorySpendTree(
      [
        tx("2026-06-02", 50, "dine"),
        tx("2026-06-03", 120, "groc"),
        tx("2026-06-04", 30, "ent"), // the parent's own
        tx("2026-06-05", 80, "golf"),
        tx("2026-06-06", 90, "movies"),
        tx("2026-06-07", 10, "golf"),
        tx("2026-06-08", 60, null),
      ],
      categories,
      june,
    );
    expect(tree).toEqual([
      {
        categoryId: "ent",
        name: "Entertainment",
        color: "violet",
        tint: null,
        icon: null,
        total: 210,
        own: 30,
        children: [
          // Tints follow manual sibling order (Golf first), not the ranking.
          { categoryId: "golf", name: "Golf", color: "violet", tint: 25, icon: null, total: 90, own: 90, children: [] },
          { categoryId: "movies", name: "Movies", color: "violet", tint: 40, icon: null, total: 90, own: 90, children: [] },
        ],
      },
      { categoryId: "groc", name: "Groceries", color: "aqua", tint: null, icon: "shopping-cart", total: 120, own: 120, children: [] },
      { categoryId: null, name: "Uncategorized", color: null, tint: null, icon: null, total: 60, own: 60, children: [] },
      { categoryId: "dine", name: "Dining", color: null, tint: null, icon: null, total: 50, own: 50, children: [] },
    ]);
  });
});

describe("categorySpendTree filtering and refunds", () => {
  it("counts only the period's non-excluded expense spend", () => {
    const tree = categorySpendTree(
      [
        tx("2026-06-03", 120, "groc"),
        tx("2026-05-31", 999, "groc"), // previous month
        tx("2026-06-05", 999, "dine", "expense", true), // excluded or split
        tx("2026-06-06", 999, "dine", "transfer"),
        tx("2026-06-01", -3000, null, "income"),
      ],
      categories,
      june,
    );
    expect(tree.map((n) => [n.name, n.total])).toEqual([["Groceries", 120]]);
  });

  it("nets refunds in, leaving a category negative and last, and drops what nets to zero", () => {
    const tree = categorySpendTree(
      [
        tx("2026-06-02", 200, "groc"),
        tx("2026-06-04", 40, "golf"),
        tx("2026-06-09", -90, "golf"), // refund of a May purchase
        tx("2026-06-10", 25, "dine"),
        tx("2026-06-11", -25, "dine"), // fully refunded: nothing to show
        tx("2026-06-12", 15, "movies"),
        tx("2026-06-13", -15, "movies"),
      ],
      categories,
      june,
    );
    expect(tree).toMatchObject([
      { name: "Groceries", total: 200 },
      { name: "Entertainment", total: -50, own: 0, children: [{ name: "Golf", total: -50 }] },
    ]);
    expect(tree).toHaveLength(2);
  });

  it("ranks Subcategories largest first within their parent", () => {
    const tree = categorySpendTree([tx("2026-06-04", 5, "golf"), tx("2026-06-05", 9, "movies")], categories, june);
    expect(tree[0]?.children.map((c) => [c.name, c.total])).toEqual([
      ["Movies", 9],
      ["Golf", 5],
    ]);
  });

  it("gives an uncolored parent's Subcategories no color or tint", () => {
    const tree = categorySpendTree(
      [tx("2026-06-04", 5, "tea")],
      [cat("drinks", "Drinks"), cat("tea", "Tea", { parentId: "drinks" })],
      june,
    );
    expect(tree).toMatchObject([{ name: "Drinks", total: 5, own: 0, children: [{ name: "Tea", color: null, tint: null }] }]);
  });

  it("adds up to the period's spend in cashFlow", () => {
    const txns = [
      tx("2026-06-01", 10.1, "groc"),
      tx("2026-06-02", 20.2, "golf"),
      tx("2026-06-03", 0.3, null),
      tx("2026-06-04", 33.33, "ent"),
      tx("2026-06-05", -12.07, "movies"),
      tx("2026-06-06", 7.77, "dine", "expense", true),
      tx("2026-06-07", 500, null, "transfer"),
      tx("2026-06-08", 41.99, null, null),
    ];
    const total = categorySpendTree(txns, categories, june).reduce((s, n) => s + n.total, 0);
    const { months } = cashFlow(txns, { currentMonth: "2026-06", months: 1, firstMonth: "2026-06" });
    expect(Math.round(total * 100) / 100).toBe(months[0]?.spend);
    expect(months[0]?.spend).toBe(51.86);
  });
});

describe("categorySpendTree over a period", () => {
  const txns = [
    tx("2025-12-31", 1000, "groc"), // before this year
    tx("2026-01-01", 10, "groc"),
    tx("2026-03-22", 5, "dine"), // the day before the last 90 days
    tx("2026-03-23", 20, "dine"), // first of the last 90 days
    tx("2026-05-15", 40, null),
    tx("2026-06-20", 2, "groc"), // today
  ];
  const totals = (period: Parameters<typeof resolvePeriodBounds>[0]) =>
    categorySpendTree(txns, categories, resolvePeriodBounds(period, today)).map((n) => [n.name, n.total]);

  it("includes both ends of a preset's range", () => {
    expect(totals({ kind: "preset", preset: "90d" })).toEqual([
      ["Uncategorized", 40],
      ["Dining", 20],
      ["Groceries", 2],
    ]);
  });

  it("starts year to date on January 1st", () => {
    expect(totals({ kind: "preset", preset: "ytd" })).toEqual([
      ["Uncategorized", 40],
      ["Dining", 25],
      ["Groceries", 12],
    ]);
  });

  it("covers every transaction for all time", () => {
    expect(totals({ kind: "all" })).toEqual([
      ["Groceries", 1012],
      ["Uncategorized", 40],
      ["Dining", 25],
    ]);
  });
});
