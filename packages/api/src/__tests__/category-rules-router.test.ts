/**
 * Category Rules CRUD + rule-aware Plaid sync (KOI-298).
 *
 * Mocked db: each db.select() call consumes the next queued result; writes are
 * recorded so tests can assert on table, values and rendered WHERE params.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, makeChain, mockPlaid } = vi.hoisted(() => {
  function makeChain(resolveWith: unknown = [], calls?: Array<[string, unknown[]]>) {
    const proxy: any = new Proxy(
      {},
      {
        get(_, prop: string) {
          if (prop === "then") return (ok: any) => Promise.resolve(resolveWith).then(ok);
          if (prop === "catch") return (err: any) => Promise.resolve(resolveWith).catch(err);
          if (prop === "finally") return (fin: any) => Promise.resolve(resolveWith).finally(fin);
          return (...args: unknown[]) => {
            calls?.push([prop, args]);
            return proxy;
          };
        },
      },
    );
    return proxy;
  }

  const mockDb = {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    select: vi.fn(),
    transaction: vi.fn(),
  };

  return { mockDb, makeChain, mockPlaid: { transactionsSync: vi.fn() } };
});

vi.mock("@life-tracker/db", () => ({ db: mockDb }));
vi.mock("../lib/token-encryption", () => ({
  decryptToken: (enc: string) => `access-${enc}`,
}));
vi.mock("../lib/plaid-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/plaid-client")>()),
  getPlaidClient: () => mockPlaid,
  getTokenEncryptionKey: () =>
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
}));

import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import { categoryRule, transaction } from "@life-tracker/db/schema/index";

import { syncPlaidItem } from "../lib/plaid-sync-db";
import { appRouter } from "../routers/index";

const USER_ID = "user-rules";
const ITEM_ID = "00000000-0000-4000-8000-0000000000a1";
const RULE_ID = "00000000-0000-4000-8000-0000000000b1";
const CAT_ID = "00000000-0000-4000-8000-0000000000c1";

const render = (clause: unknown) => new PgDialect().sqlToQuery(clause as SQL);

type Calls = Array<[string, unknown[]]>;
let insertCalls: Array<{ table: unknown; calls: Calls; returning: unknown[] }>;
let deleteCalls: Array<{ table: unknown; calls: Calls }>;
let insertReturns: unknown[];
let deleteReturns: unknown[];

/** Next db.select() resolves to these rows and records its WHERE clause. */
function selectReturns(rows: unknown[]): { params: () => unknown[] } {
  const calls: Calls = [];
  mockDb.select.mockReturnValueOnce(makeChain(rows, calls));
  return {
    params: () => {
      const where = calls.find(([m]) => m === "where")?.[1][0];
      return where ? render(where).params : [];
    },
  };
}

const callArg = (calls: Calls, method: string) => calls.find(([m]) => m === method)?.[1][0];

function makeCaller() {
  return appRouter.createCaller({ session: { user: { id: USER_ID } } } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
  insertCalls = [];
  deleteCalls = [];
  insertReturns = [{ id: RULE_ID }];
  deleteReturns = [{ id: RULE_ID }];
  mockDb.insert.mockImplementation((table: unknown) => {
    const calls: Calls = [];
    insertCalls.push({ table, calls, returning: insertReturns });
    return makeChain(table === categoryRule ? insertReturns : [], calls);
  });
  mockDb.update.mockImplementation(() => makeChain([]));
  mockDb.delete.mockImplementation((table: unknown) => {
    const calls: Calls = [];
    deleteCalls.push({ table, calls });
    return makeChain(table === categoryRule ? deleteReturns : [], calls);
  });
});

describe("categoryRules.list", () => {
  it("returns the caller's rules with their category", async () => {
    const rows = [
      { id: RULE_ID, pattern: "starbucks", categoryId: CAT_ID, categoryName: "Coffee", createdAt: new Date() },
    ];
    const q = selectReturns(rows);

    await expect(makeCaller().categoryRules.list()).resolves.toEqual(rows);
    expect(q.params()).toEqual([USER_ID]);
  });
});

describe("categoryRules.create", () => {
  it("inserts a trimmed pattern for an owned category", async () => {
    const owned = selectReturns([{ id: CAT_ID }]);
    const existing = selectReturns([{ id: "r-other", pattern: "uber" }]);

    const result = await makeCaller().categoryRules.create({ pattern: "  Starbucks ", categoryId: CAT_ID });

    expect(result).toEqual({ id: RULE_ID });
    expect(owned.params()).toEqual([CAT_ID, USER_ID]);
    expect(existing.params()).toEqual([USER_ID]);
    const insert = insertCalls.find((i) => i.table === categoryRule)!;
    expect(callArg(insert.calls, "values")).toMatchObject({
      userId: USER_ID,
      pattern: "Starbucks",
      categoryId: CAT_ID,
    });
  });

  it("rejects a foreign or missing category with NOT_FOUND", async () => {
    selectReturns([]);

    await expect(
      makeCaller().categoryRules.create({ pattern: "starbucks", categoryId: CAT_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(insertCalls).toEqual([]);
  });

  it("rejects a too-short pattern with BAD_REQUEST and a reason", async () => {
    selectReturns([{ id: CAT_ID }]);
    selectReturns([]);

    await expect(
      makeCaller().categoryRules.create({ pattern: " ab ", categoryId: CAT_ID }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/at least 3/) });
    expect(insertCalls).toEqual([]);
  });

  it("rejects a case-insensitive duplicate with BAD_REQUEST", async () => {
    selectReturns([{ id: CAT_ID }]);
    selectReturns([{ id: "r-existing", pattern: "Starbucks" }]);

    await expect(
      makeCaller().categoryRules.create({ pattern: "STARBUCKS", categoryId: CAT_ID }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringMatching(/already exists/) });
    expect(insertCalls).toEqual([]);
  });

  it("maps a lost insert race on the unique index to BAD_REQUEST", async () => {
    selectReturns([{ id: CAT_ID }]);
    selectReturns([]);
    insertReturns = [];

    await expect(
      makeCaller().categoryRules.create({ pattern: "starbucks", categoryId: CAT_ID }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("categoryRules.delete", () => {
  it("deletes only the caller's rule and leaves transactions untouched", async () => {
    await makeCaller().categoryRules.delete({ id: RULE_ID });

    expect(deleteCalls.map((d) => d.table)).toEqual([categoryRule]);
    expect(render(callArg(deleteCalls[0]!.calls, "where")).params).toEqual([RULE_ID, USER_ID]);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("rejects a rule the caller doesn't own with NOT_FOUND", async () => {
    deleteReturns = [];

    await expect(makeCaller().categoryRules.delete({ id: RULE_ID })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

function syncWith(names: string[], rules: unknown[]) {
  selectReturns([{ id: ITEM_ID, userId: USER_ID, accessTokenEnc: "enc", transactionCursor: null }]);
  mockPlaid.transactionsSync.mockResolvedValueOnce({
    data: {
      added: names.map((name, i) => ({
        transaction_id: `plaid-txn-${i}`,
        account_id: "p_chk",
        amount: 12,
        date: "2026-09-30",
        name,
        pending: false,
        personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: null },
      })),
      modified: [],
      removed: [],
      accounts: [],
      next_cursor: "c2",
      has_more: false,
    },
  });
  selectReturns([{ id: "fa-chk", plaidAccountId: "p_chk" }]); // accounts
  selectReturns([{ id: "cat-food", name: "Food & Drink" }]); // categories
  const rulesQuery = selectReturns(rules); // rules
  selectReturns([]); // transfer candidates
  return rulesQuery;
}

const insertedCategoryIds = () =>
  insertCalls
    .filter((i) => i.table === transaction)
    .map((i) => (callArg(i.calls, "values") as { categoryId: string | null }).categoryId);

describe("syncPlaidItem with Category Rules", () => {
  it("loads the user's rules once and categorizes new transactions by them", async () => {
    const rulesQuery = syncWith(
      ["SQ *STARBUCKS #12", "CHIPOTLE 42"],
      [{ id: "r1", pattern: "starbucks", categoryId: "cat-coffee", createdAt: new Date() }],
    );

    await syncPlaidItem(ITEM_ID);

    expect(rulesQuery.params()).toEqual([USER_ID]);
    expect(insertedCategoryIds()).toEqual(["cat-coffee", "cat-food"]);
    expect(mockDb.select).toHaveBeenCalledTimes(5);
  });

  it("still leaves categoryId alone on conflict", async () => {
    syncWith(["STARBUCKS"], [{ id: "r1", pattern: "starbucks", categoryId: "cat-coffee", createdAt: new Date() }]);

    await syncPlaidItem(ITEM_ID);

    const upsert = insertCalls.find((i) => i.table === transaction)!;
    const onConflict = callArg(upsert.calls, "onConflictDoUpdate") as { set: Record<string, unknown> };
    expect(onConflict.set).not.toHaveProperty("categoryId");
  });
});
