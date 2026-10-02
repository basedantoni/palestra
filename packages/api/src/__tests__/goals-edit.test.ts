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
  const mockDb = { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(), transaction: vi.fn() };
  return { mockDb, makeChain };
});

vi.mock("@life-tracker/db", () => ({ db: mockDb }));

import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import { appRouter } from "../routers/index";

const USER_ID = "user-goals";
const GOAL = "00000000-0000-4000-8000-0000000000a1";
const ACCT_1 = "00000000-0000-4000-8000-0000000000b1";
const ACCT_2 = "00000000-0000-4000-8000-0000000000b2";

const makeCaller = () => appRouter.createCaller({ session: { user: { id: USER_ID } } } as any);
const render = (clause: unknown) => new PgDialect().sqlToQuery(clause as SQL).params;

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
});

describe("goals.update", () => {
  it("changes only the given fields on the caller's goal", async () => {
    const goalParams = selectReturning([{ id: GOAL }]);

    await makeCaller().goals.update({ id: GOAL, name: "Rainy day fund", targetDate: null });

    expect(goalParams()).toEqual([GOAL, USER_ID]);
    expect(updates).toEqual([{ set: { name: "Rainy day fund", targetDate: null }, where: [GOAL, USER_ID] }]);
    expect(deletedWhere).toEqual([]);
    expect(inserted).toEqual([]);
  });

  it("replaces linked accounts after checking the caller owns all of them", async () => {
    selectReturning([{ id: GOAL }]);
    const acctParams = selectReturning([{ id: ACCT_1 }, { id: ACCT_2 }]);

    await makeCaller().goals.update({ id: GOAL, accountIds: [ACCT_1, ACCT_2] });

    expect(acctParams()).toEqual([USER_ID, ACCT_1, ACCT_2]);
    expect(deletedWhere).toEqual([[GOAL]]);
    expect(inserted).toEqual([
      [
        { goalId: GOAL, accountId: ACCT_1 },
        { goalId: GOAL, accountId: ACCT_2 },
      ],
    ]);
  });

  it("refuses accounts the caller doesn't own, writing nothing", async () => {
    selectReturning([{ id: GOAL }]);
    selectReturning([{ id: ACCT_1 }]); // ACCT_2 isn't theirs

    await expect(
      makeCaller().goals.update({ id: GOAL, name: "x", accountIds: [ACCT_1, ACCT_2] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(updates).toEqual([]);
    expect(deletedWhere).toEqual([]);
    expect(inserted).toEqual([]);
  });

  it("requires at least one linked account", async () => {
    await expect(makeCaller().goals.update({ id: GOAL, accountIds: [] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("returns NOT_FOUND for a goal the caller doesn't own", async () => {
    selectReturning([]);

    await expect(makeCaller().goals.update({ id: GOAL, name: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(updates).toEqual([]);
  });
});

/** YYYY-MM-DD, `i` days after 2026-01-01. */
const day = (i: number) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);

describe("goals.list history", () => {
  it("returns the summed daily balance series for the chart, capped to the latest 180 days", async () => {
    selectReturning([{ id: GOAL, userId: USER_ID, name: "Fund", targetAmount: 5000, targetDate: null }]);
    selectReturning([{ accountId: ACCT_1 }, { accountId: ACCT_2 }]);
    // 200 days × 2 accounts
    selectReturning(
      Array.from({ length: 200 }, (_, i) => [
        { asOfDate: day(i), balance: 100 + i },
        { asOfDate: day(i), balance: 1000 },
      ]).flat(),
    );

    const [goal] = await makeCaller().goals.list();

    expect(goal!.history).toHaveLength(180);
    expect(goal!.history[0]).toEqual({ asOfDate: day(20), balance: 1120 });
    expect(goal!.history.at(-1)).toEqual({ asOfDate: day(199), balance: 1299 });
  });
});
