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

const { mockDb, makeChain } = vi.hoisted(() => {
  /** Thenable query-builder stand-in; reports where()/values()/set() calls. */
  function makeChain(resolveWith: unknown = [], spy?: (method: string, arg: unknown) => void) {
    const proxy: any = new Proxy(
      {},
      {
        get(_, prop: string) {
          if (prop === "then") return (ok: any) => Promise.resolve(resolveWith).then(ok);
          return (arg: unknown) => {
            spy?.(prop, arg);
            return proxy;
          };
        },
      },
    );
    return proxy;
  }
  const mockDb = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  };
  return { mockDb, makeChain };
});

vi.mock("@life-tracker/db", () => ({ db: mockDb }));

import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import { appRouter } from "../routers/index";

const USER_ID = "user-budgets";
const FOOD = "00000000-0000-4000-8000-0000000000f1";
const FUN = "00000000-0000-4000-8000-0000000000f2";

function makeCaller() {
  return appRouter.createCaller({ session: { user: { id: USER_ID } } } as any);
}

const render = (clause: unknown) => new PgDialect().sqlToQuery(clause as SQL).params;

/** Queue a db.select() result; returns the rendered WHERE params once it ran. */
function selectReturning(rows: unknown[]): () => unknown[] {
  let where: unknown;
  mockDb.select.mockReturnValueOnce(makeChain(rows, (m, a) => m === "where" && (where = a)));
  return () => (where ? render(where) : []);
}

let inserted: unknown[];
let deletedWhere: unknown[];
let updates: Array<{ set: unknown; where?: unknown }>;

beforeEach(() => {
  vi.clearAllMocks();
  inserted = [];
  deletedWhere = [];
  updates = [];
  mockDb.insert.mockImplementation(() => makeChain([], (m, a) => m === "values" && inserted.push(a)));
  mockDb.delete.mockImplementation(() => makeChain([], (m, a) => m === "where" && deletedWhere.push(render(a))));
  mockDb.update.mockImplementation(() => {
    const u: { set: unknown; where?: unknown } = { set: undefined };
    updates.push(u);
    return makeChain([], (m, a) => {
      if (m === "set") u.set = a;
      if (m === "where") u.where = render(a);
    });
  });
  mockDb.transaction.mockImplementation((cb: (tx: typeof mockDb) => unknown) => cb(mockDb));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T18:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

/** The user_preferences timezone lookup. */
const userTimezoneIs = (timezone: string) => selectReturning([{ timezone }]);

describe("budgets.carryOver", () => {
  it("copies the latest earlier month's limits into an empty current month", async () => {
    userTimezoneIs("America/Chicago");
    selectReturning([]); // October has no limits yet
    selectReturning([{ monthKey: "2026-08" }]); // latest earlier month with limits
    const sourceParams = selectReturning([
      { categoryId: FOOD, limitAmount: 400 },
      { categoryId: FUN, limitAmount: 80 },
    ]);

    const result = await makeCaller().budgets.carryOver({ monthKey: "2026-10" });

    expect(result).toEqual({ fromMonth: "2026-08", copied: 2 });
    expect(sourceParams()).toEqual([USER_ID, "2026-08"]);
    expect(inserted).toEqual([
      [
        expect.objectContaining({ userId: USER_ID, categoryId: FOOD, monthKey: "2026-10", limitAmount: 400 }),
        expect.objectContaining({ userId: USER_ID, categoryId: FUN, monthKey: "2026-10", limitAmount: 80 }),
      ],
    ]);
  });

  it("does nothing for a past month", async () => {
    userTimezoneIs("America/Chicago");

    await expect(makeCaller().budgets.carryOver({ monthKey: "2026-09" })).resolves.toEqual({
      fromMonth: null,
      copied: 0,
    });
    expect(inserted).toEqual([]);
  });

  it("does nothing when the month already has limits", async () => {
    userTimezoneIs("America/Chicago");
    selectReturning([{ id: "existing" }]);

    await expect(makeCaller().budgets.carryOver({ monthKey: "2026-11" })).resolves.toEqual({
      fromMonth: null,
      copied: 0,
    });
    expect(inserted).toEqual([]);
  });

  it("does nothing when no earlier month has limits", async () => {
    userTimezoneIs("America/Chicago");
    selectReturning([]);
    selectReturning([{ monthKey: null }]);

    await expect(makeCaller().budgets.carryOver({ monthKey: "2026-10" })).resolves.toEqual({
      fromMonth: null,
      copied: 0,
    });
    expect(inserted).toEqual([]);
  });
});

describe("budget row mutations", () => {
  it("clearMonth deletes only the caller's limits for that month", async () => {
    await makeCaller().budgets.clearMonth({ monthKey: "2026-10" });

    expect(deletedWhere).toEqual([[USER_ID, "2026-10"]]);
  });

  it("remove deletes the caller's limit for one category and month", async () => {
    await makeCaller().budgets.remove({ categoryId: FOOD, monthKey: "2026-10" });

    expect(deletedWhere).toEqual([[USER_ID, FOOD, "2026-10"]]);
  });

  it("upsert refuses a category the caller doesn't own", async () => {
    const params = selectReturning([]);

    await expect(
      makeCaller().budgets.upsert({ categoryId: FOOD, monthKey: "2026-10", limitAmount: 300 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(params()).toEqual([FOOD, USER_ID]);
    expect(inserted).toEqual([]);
  });

  it("upsert writes the limit for an owned category", async () => {
    selectReturning([{ id: FOOD }]);

    await makeCaller().budgets.upsert({ categoryId: FOOD, monthKey: "2026-10", limitAmount: 300 });

    expect(inserted).toEqual([
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
    selectReturning([
      { id: FOOD, name: "Food & Drink", isSystem: true },
      { id: FUN, name: "Climbing", isSystem: false },
    ]);
    selectReturning([{ categoryId: FOOD, limitAmount: 100 }]);
    const txnParams = selectReturning([spendRow(FOOD, 130, "2026-10-03"), spendRow(FUN, 25, "2026-10-04")]);

    const rows = await makeCaller().budgets.forMonth({ monthKey: "2026-10" });

    expect(rows).toEqual([
      { categoryId: FOOD, categoryName: "Food & Drink", isSystem: true, limit: 100, spent: 130, overspent: true },
      { categoryId: FUN, categoryName: "Climbing", isSystem: false, limit: null, spent: 25, overspent: false },
    ]);
    expect(txnParams()).toEqual([USER_ID, "2026-10-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z"]);
  });
});

describe("budgets.history", () => {
  it("returns spend and limit for the category over the months ending at monthKey", async () => {
    selectReturning([{ monthKey: "2026-09", limitAmount: 100 }]);
    const txnParams = selectReturning([spendRow(FOOD, 40, "2026-08-10"), spendRow(FOOD, 120, "2026-09-02")]);

    const history = await makeCaller().budgets.history({ categoryId: FOOD, monthKey: "2026-10", months: 3 });

    expect(history).toEqual([
      { monthKey: "2026-08", spent: 40, limit: null },
      { monthKey: "2026-09", spent: 120, limit: 100 },
      { monthKey: "2026-10", spent: 0, limit: null },
    ]);
    expect(txnParams()).toEqual([USER_ID, FOOD, "2026-08-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z"]);
  });
});

describe("categories rename/delete", () => {
  const CUSTOM = { id: FUN, isSystem: false };
  const BUILT_IN = { id: FOOD, isSystem: true };

  it("refuses to rename a built-in category", async () => {
    selectReturning([BUILT_IN]);

    await expect(makeCaller().categories.rename({ id: FOOD, name: "Eating out" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(updates).toEqual([]);
  });

  it("renames a custom category the caller owns", async () => {
    const params = selectReturning([CUSTOM]);

    await makeCaller().categories.rename({ id: FUN, name: "Bouldering" });

    expect(params()).toEqual([FUN, USER_ID]);
    expect(updates).toEqual([{ set: { name: "Bouldering" }, where: [FUN, USER_ID] }]);
  });

  // Uncategorized means no category; a real category of that name would be a second one (KOI-301).
  it("refuses to create a category named Uncategorized, in any case", async () => {
    await expect(makeCaller().categories.create({ name: " uncategorized " })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: '"Uncategorized" is reserved for transactions with no category',
    });
    expect(inserted).toEqual([]);
  });

  it("refuses to rename a category to Uncategorized", async () => {
    // Rejected by the reserved-name check before any query: queue no select.
    await expect(makeCaller().categories.rename({ id: FUN, name: "Uncategorized" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(updates).toEqual([]);
  });

  it("refuses to delete a built-in category", async () => {
    selectReturning([BUILT_IN]);

    await expect(makeCaller().categories.remove({ id: FOOD })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(deletedWhere).toEqual([]);
  });

  it("returns NOT_FOUND for a category the caller doesn't own", async () => {
    selectReturning([]);

    await expect(makeCaller().categories.remove({ id: FUN })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(deletedWhere).toEqual([]);
  });

  it("moves transactions to another owned category, then deletes", async () => {
    selectReturning([CUSTOM]);
    const targetParams = selectReturning([{ id: FOOD }]);

    await makeCaller().categories.remove({ id: FUN, moveToCategoryId: FOOD });

    expect(targetParams()).toEqual([FOOD, USER_ID]);
    expect(updates).toEqual([{ set: { categoryId: FOOD }, where: [USER_ID, FUN] }]);
    expect(deletedWhere).toEqual([[FUN, USER_ID]]);
  });

  it("refuses a move target the caller doesn't own", async () => {
    selectReturning([CUSTOM]);
    selectReturning([]);

    await expect(
      makeCaller().categories.remove({ id: FUN, moveToCategoryId: FOOD }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(updates).toEqual([]);
    expect(deletedWhere).toEqual([]);
  });

  it("refuses moving a category's transactions into itself", async () => {
    await expect(
      makeCaller().categories.remove({ id: FUN, moveToCategoryId: FUN }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("without a target, deletes and leaves transactions to become Uncategorized", async () => {
    selectReturning([CUSTOM]);

    await makeCaller().categories.remove({ id: FUN });

    expect(updates).toEqual([]);
    expect(deletedWhere).toEqual([[FUN, USER_ID]]);
  });
});

describe("budgets.carryOverPreview", () => {
  it("reports which month would be copied and how many limits", async () => {
    userTimezoneIs("America/Chicago");
    selectReturning([]); // target month empty
    selectReturning([{ monthKey: "2026-09" }]);
    selectReturning([
      { categoryId: FOOD, limitAmount: 400 },
      { categoryId: FUN, limitAmount: 80 },
    ]);

    await expect(makeCaller().budgets.carryOverPreview({ monthKey: "2026-10" })).resolves.toEqual({
      fromMonth: "2026-09",
      count: 2,
    });
    expect(inserted).toEqual([]);
  });

  it("is null for a past month", async () => {
    userTimezoneIs("America/Chicago");

    await expect(makeCaller().budgets.carryOverPreview({ monthKey: "2026-08" })).resolves.toBeNull();
  });

  it("is null when the month already has limits", async () => {
    userTimezoneIs("America/Chicago");
    selectReturning([{ id: "existing" }]);

    await expect(makeCaller().budgets.carryOverPreview({ monthKey: "2026-10" })).resolves.toBeNull();
  });
});

describe("month keys", () => {
  it.each(["2026-13", "2026-00"])("rejects %s", async (monthKey) => {
    await expect(makeCaller().budgets.forMonth({ monthKey })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
