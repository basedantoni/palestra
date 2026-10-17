/**
 * Integration tests: budgets page (KOI-284 month carry-over, KOI-285 remove,
 * KOI-287 category rename/delete).
 *
 * - carryOverPreview / carryOver: the explicit "Copy September's limits"
 *   action copies the latest earlier month's limits into an empty current or
 *   future month; never into a past month or one that already has limits
 * - month keys must be real months (01–12)
 * - clearMonth / remove only touch the caller's rows
 * - upsert refuses a category the caller doesn't own
 * - built-in categories can't be renamed or deleted; deleting a custom one
 *   can move its transactions to another owned category first
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@life-tracker/db", () => import("./helpers/mock-db").then((m) => m.mockDbModule));

import { budget, category, transaction, userPreferences } from "@life-tracker/db/schema/index";

import { appRouter } from "../routers/index";
import { mockDb } from "./helpers/mock-db";

const USER_ID = "user-budgets";
const FOOD = "00000000-0000-4000-8000-0000000000f1";
const FUN = "00000000-0000-4000-8000-0000000000f2";

function makeCaller() {
  return appRouter.createCaller({ session: { user: { id: USER_ID } } } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T18:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

/** The user_preferences timezone lookup. */
const userTimezoneIs = (timezone: string) => mockDb.onSelect(userPreferences, [{ timezone }]);

/**
 * carryOver / carryOverPreview read budget three times: the target month's
 * limits, the latest earlier month with limits, then that month's limits.
 */
function budgetReads(target: unknown[], latest?: unknown[], source?: unknown[]) {
  mockDb.onSelect(budget, ...[target, latest, source].filter((r) => r !== undefined));
}

describe("budgets.carryOver", () => {
  it("copies the latest earlier month's limits into an empty current month", async () => {
    userTimezoneIs("America/Chicago");
    budgetReads(
      [], // October has no limits yet
      [{ monthKey: "2026-08" }], // latest earlier month with limits
      [
        { categoryId: FOOD, limitAmount: 400 },
        { categoryId: FUN, limitAmount: 80 },
      ],
    );

    const result = await makeCaller().budgets.carryOver({ monthKey: "2026-10" });

    expect(result).toEqual({ fromMonth: "2026-08", copied: 2 });
    expect(mockDb.selected(budget)[2]).toEqual([USER_ID, "2026-08"]);
    expect(mockDb.inserted(budget)).toEqual([
      expect.objectContaining({ userId: USER_ID, categoryId: FOOD, monthKey: "2026-10", limitAmount: 400 }),
      expect.objectContaining({ userId: USER_ID, categoryId: FUN, monthKey: "2026-10", limitAmount: 80 }),
    ]);
  });

  it("does nothing for a past month", async () => {
    userTimezoneIs("America/Chicago");

    await expect(makeCaller().budgets.carryOver({ monthKey: "2026-09" })).resolves.toEqual({
      fromMonth: null,
      copied: 0,
    });
    expect(mockDb.inserted(budget)).toEqual([]);
  });

  it("does nothing when the month already has limits", async () => {
    userTimezoneIs("America/Chicago");
    budgetReads([{ id: "existing" }]);

    await expect(makeCaller().budgets.carryOver({ monthKey: "2026-11" })).resolves.toEqual({
      fromMonth: null,
      copied: 0,
    });
    expect(mockDb.inserted(budget)).toEqual([]);
  });

  it("does nothing when no earlier month has limits", async () => {
    userTimezoneIs("America/Chicago");
    budgetReads([], [{ monthKey: null }]);

    await expect(makeCaller().budgets.carryOver({ monthKey: "2026-10" })).resolves.toEqual({
      fromMonth: null,
      copied: 0,
    });
    expect(mockDb.inserted(budget)).toEqual([]);
  });
});

describe("budget row mutations", () => {
  it("clearMonth deletes only the caller's limits for that month", async () => {
    await makeCaller().budgets.clearMonth({ monthKey: "2026-10" });

    expect(mockDb.deleted(budget)).toEqual([[USER_ID, "2026-10"]]);
  });

  it("remove deletes the caller's limit for one category and month", async () => {
    await makeCaller().budgets.remove({ categoryId: FOOD, monthKey: "2026-10" });

    expect(mockDb.deleted(budget)).toEqual([[USER_ID, FOOD, "2026-10"]]);
  });

  it("upsert refuses a category the caller doesn't own", async () => {
    // Nothing queued: the ownership lookup finds no category.
    await expect(
      makeCaller().budgets.upsert({ categoryId: FOOD, monthKey: "2026-10", limitAmount: 300 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockDb.selected(category)).toEqual([[FOOD, USER_ID]]);
    expect(mockDb.inserted(budget)).toEqual([]);
  });

  it("upsert writes the limit for an owned category", async () => {
    mockDb.onSelect(category, [{ id: FOOD }]);

    await makeCaller().budgets.upsert({ categoryId: FOOD, monthKey: "2026-10", limitAmount: 300 });

    expect(mockDb.inserted(budget)).toEqual([
      expect.objectContaining({ userId: USER_ID, categoryId: FOOD, monthKey: "2026-10", limitAmount: 300 }),
    ]);
  });
});

const spendRow = (categoryId: string, amount: number, day: string, extra = {}) => ({
  categoryId,
  amount,
  flow: "expense",
  excluded: false,
  date: new Date(`${day}T00:00:00.000Z`),
  ...extra,
});

describe("budgets.forMonth", () => {
  it("returns every category with its limit (or none) and spend, reading only that month", async () => {
    mockDb.onSelect(category, [
      { id: FOOD, name: "Food & Drink", isSystem: true },
      { id: FUN, name: "Climbing", isSystem: false },
    ]);
    mockDb.onSelect(budget, [{ categoryId: FOOD, limitAmount: 100 }]);
    mockDb.onSelect(transaction, [spendRow(FOOD, 130, "2026-10-03"), spendRow(FUN, 25, "2026-10-04")]);

    const rows = await makeCaller().budgets.forMonth({ monthKey: "2026-10" });

    expect(rows).toEqual([
      { categoryId: FOOD, categoryName: "Food & Drink", limit: 100, spent: 130, overspent: true },
      { categoryId: FUN, categoryName: "Climbing", limit: null, spent: 25, overspent: false },
    ]);
    expect(mockDb.selected(transaction)).toEqual([
      [USER_ID, "2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z"],
    ]);
  });
});

describe("budgets.history", () => {
  it("returns spend and limit for the category over the months ending at monthKey", async () => {
    mockDb.onSelect(budget, [{ monthKey: "2026-09", limitAmount: 100 }]);
    mockDb.onSelect(transaction, [spendRow(FOOD, 40, "2026-08-10"), spendRow(FOOD, 120, "2026-09-02")]);

    const history = await makeCaller().budgets.history({ categoryId: FOOD, monthKey: "2026-10", months: 3 });

    expect(history).toEqual([
      { monthKey: "2026-08", spent: 40, limit: null },
      { monthKey: "2026-09", spent: 120, limit: 100 },
      { monthKey: "2026-10", spent: 0, limit: null },
    ]);
    expect(mockDb.selected(transaction)).toEqual([
      [USER_ID, FOOD, "2026-08-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z"],
    ]);
  });
});

describe("categories rename/delete", () => {
  const CUSTOM = { id: FUN, isSystem: false };
  const BUILT_IN = { id: FOOD, isSystem: true };

  // The Bank Category mapping holds seeded categories by id, so they are no longer locked (KOI-335).
  it("renames a seeded category", async () => {
    mockDb.onSelect(category, [BUILT_IN]);

    await makeCaller().categories.rename({ id: FOOD, name: "Eating out" });

    expect(mockDb.updated(category)).toEqual([{ set: { name: "Eating out" }, where: [FOOD, USER_ID] }]);
  });

  it("renames a custom category the caller owns", async () => {
    mockDb.onSelect(category, [CUSTOM]);

    await makeCaller().categories.rename({ id: FUN, name: "Bouldering" });

    expect(mockDb.selected(category)).toEqual([[FUN, USER_ID]]);
    expect(mockDb.updated(category)).toEqual([{ set: { name: "Bouldering" }, where: [FUN, USER_ID] }]);
  });

  // Uncategorized means no category; a real category of that name would be a second one (KOI-301).
  it("refuses to create a category named Uncategorized, in any case", async () => {
    await expect(makeCaller().categories.create({ name: " uncategorized " })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: '"Uncategorized" is reserved for transactions with no category',
    });
    expect(mockDb.inserted(category)).toEqual([]);
  });

  it("refuses to rename a category to Uncategorized", async () => {
    await expect(makeCaller().categories.rename({ id: FUN, name: "Uncategorized" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(mockDb.updated(category)).toEqual([]);
  });

  it("deletes a seeded category", async () => {
    mockDb.onSelect(category, [BUILT_IN]);

    await makeCaller().categories.remove({ id: FOOD });

    expect(mockDb.deleted(category)).toEqual([[FOOD, USER_ID]]);
  });

  it("returns NOT_FOUND for a category the caller doesn't own", async () => {
    // Nothing queued: the ownership lookup finds no category.
    await expect(makeCaller().categories.remove({ id: FUN })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockDb.deleted(category)).toEqual([]);
  });

  it("moves transactions to another owned category, then deletes", async () => {
    // The category being deleted, then the move target.
    mockDb.onSelect(category, [CUSTOM], [{ id: FOOD }]);

    await makeCaller().categories.remove({ id: FUN, moveToCategoryId: FOOD });

    expect(mockDb.selected(category)[1]).toEqual([FOOD, USER_ID]);
    expect(mockDb.updated(transaction)).toEqual([{ set: { categoryId: FOOD }, where: [USER_ID, FUN] }]);
    expect(mockDb.deleted(category)).toEqual([[FUN, USER_ID]]);
  });

  it("refuses a move target the caller doesn't own", async () => {
    mockDb.onSelect(category, [CUSTOM], []);

    await expect(
      makeCaller().categories.remove({ id: FUN, moveToCategoryId: FOOD }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockDb.updated(transaction)).toEqual([]);
    expect(mockDb.deleted(category)).toEqual([]);
  });

  it("refuses moving a category's transactions into itself", async () => {
    await expect(
      makeCaller().categories.remove({ id: FUN, moveToCategoryId: FUN }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("without a target, deletes and leaves transactions to become Uncategorized", async () => {
    mockDb.onSelect(category, [CUSTOM]);

    await makeCaller().categories.remove({ id: FUN });

    expect(mockDb.updated(transaction)).toEqual([]);
    expect(mockDb.deleted(category)).toEqual([[FUN, USER_ID]]);
  });
});

describe("budgets.carryOverPreview", () => {
  it("reports which month would be copied and how many limits", async () => {
    userTimezoneIs("America/Chicago");
    budgetReads(
      [], // target month empty
      [{ monthKey: "2026-09" }],
      [
        { categoryId: FOOD, limitAmount: 400 },
        { categoryId: FUN, limitAmount: 80 },
      ],
    );

    await expect(makeCaller().budgets.carryOverPreview({ monthKey: "2026-10" })).resolves.toEqual({
      fromMonth: "2026-09",
      count: 2,
    });
    expect(mockDb.inserted(budget)).toEqual([]);
  });

  it("is null for a past month", async () => {
    userTimezoneIs("America/Chicago");

    await expect(makeCaller().budgets.carryOverPreview({ monthKey: "2026-08" })).resolves.toBeNull();
  });

  it("is null when the month already has limits", async () => {
    userTimezoneIs("America/Chicago");
    budgetReads([{ id: "existing" }]);

    await expect(makeCaller().budgets.carryOverPreview({ monthKey: "2026-10" })).resolves.toBeNull();
  });
});

describe("month keys", () => {
  it.each(["2026-13", "2026-00"])("rejects %s", async (monthKey) => {
    await expect(makeCaller().budgets.forMonth({ monthKey })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
