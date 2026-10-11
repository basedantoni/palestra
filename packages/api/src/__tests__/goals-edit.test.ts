/**
 * Integration tests: editing savings goals (KOI-286).
 *
 * - update changes only the fields given, scoped to the caller's goal
 * - replacing linked accounts requires every account to be the caller's and
 *   at least one; the old links are swapped for the new ones atomically
 * - a goal the caller doesn't own → NOT_FOUND, nothing written
 * - list returns each goal's balance history for the trend chart
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@life-tracker/db", () => import("./helpers/mock-db").then((m) => m.mockDbModule));

import {
  balanceSnapshot,
  financialAccount,
  savingsGoal,
  savingsGoalAccount,
} from "@life-tracker/db/schema/index";

import { appRouter } from "../routers/index";
import { mockDb } from "./helpers/mock-db";

const USER_ID = "user-goals";
const GOAL = "00000000-0000-4000-8000-0000000000a1";
const ACCT_1 = "00000000-0000-4000-8000-0000000000b1";
const ACCT_2 = "00000000-0000-4000-8000-0000000000b2";

const makeCaller = () => appRouter.createCaller({ session: { user: { id: USER_ID } } } as any);

/** Every insert/update/delete, whatever the table. */
const writes = () => mockDb.ops.filter((op) => op.kind !== "select");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("goals.update", () => {
  it("changes only the given fields on the caller's goal", async () => {
    mockDb.onSelect(savingsGoal, [{ id: GOAL }]);

    await makeCaller().goals.update({ id: GOAL, name: "Rainy day fund", targetDate: null });

    expect(mockDb.selected(savingsGoal)).toEqual([[GOAL, USER_ID]]);
    expect(mockDb.updated(savingsGoal)).toEqual([
      { set: { name: "Rainy day fund", targetDate: null }, where: [GOAL, USER_ID] },
    ]);
    expect(mockDb.deleted(savingsGoalAccount)).toEqual([]);
    expect(mockDb.inserted(savingsGoalAccount)).toEqual([]);
  });

  it("replaces linked accounts after checking the caller owns all of them", async () => {
    mockDb.onSelect(savingsGoal, [{ id: GOAL }]);
    mockDb.onSelect(financialAccount, [{ id: ACCT_1 }, { id: ACCT_2 }]);

    await makeCaller().goals.update({ id: GOAL, accountIds: [ACCT_1, ACCT_2] });

    expect(mockDb.selected(financialAccount)).toEqual([[USER_ID, ACCT_1, ACCT_2]]);
    expect(mockDb.deleted(savingsGoalAccount)).toEqual([[GOAL]]);
    expect(mockDb.inserted(savingsGoalAccount)).toEqual([
      { goalId: GOAL, accountId: ACCT_1 },
      { goalId: GOAL, accountId: ACCT_2 },
    ]);
  });

  it("refuses accounts the caller doesn't own, writing nothing", async () => {
    mockDb.onSelect(savingsGoal, [{ id: GOAL }]);
    mockDb.onSelect(financialAccount, [{ id: ACCT_1 }]); // ACCT_2 isn't theirs

    await expect(
      makeCaller().goals.update({ id: GOAL, name: "x", accountIds: [ACCT_1, ACCT_2] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(writes()).toEqual([]);
  });

  it("requires at least one linked account", async () => {
    await expect(makeCaller().goals.update({ id: GOAL, accountIds: [] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("returns NOT_FOUND for a goal the caller doesn't own", async () => {
    // Nothing queued: the goal lookup finds nothing.
    await expect(makeCaller().goals.update({ id: GOAL, name: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(writes()).toEqual([]);
  });
});

/** YYYY-MM-DD, `i` days after 2026-01-01. */
const day = (i: number) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);

describe("goals.list history", () => {
  it("returns the summed daily balance series for the chart, capped to the latest 180 days", async () => {
    mockDb.onSelect(savingsGoal, [{ id: GOAL, userId: USER_ID, name: "Fund", targetAmount: 5000, targetDate: null }]);
    mockDb.onSelect(savingsGoalAccount, [{ accountId: ACCT_1 }, { accountId: ACCT_2 }]);
    // 200 days × 2 accounts
    mockDb.onSelect(
      balanceSnapshot,
      Array.from({ length: 200 }, (_, i) => [
        { accountId: ACCT_1, asOfDate: day(i), balance: 100 + i },
        { accountId: ACCT_2, asOfDate: day(i), balance: 1000 },
      ]).flat(),
    );

    const [goal] = await makeCaller().goals.list();

    expect(goal!.history).toHaveLength(180);
    expect(goal!.history[0]).toEqual({ asOfDate: day(20), balance: 1120 });
    expect(goal!.history.at(-1)).toEqual({ asOfDate: day(199), balance: 1299 });
  });
});
