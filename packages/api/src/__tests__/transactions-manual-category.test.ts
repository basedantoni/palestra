/**
 * Integration tests: Manual Category flag + Reset to automatic (KOI-297, ADR 0004).
 *
 * - transactions.setCategory marks the category manual, including Uncategorized
 * - transactions.resetCategory clears the flag and restores the Default Category
 * - the sync upsert leaves categoryId and the manual flag alone
 * - admin.backfillManualCategories flags existing rows whose category differs
 *   from their recomputed Default Category
 * - every read/write is scoped to the caller
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// ────────────────────────────────────────────────────────────────────────────
// Hoisted mocks (must run before imports)
// ────────────────────────────────────────────────────────────────────────────
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

import { transaction } from "@life-tracker/db/schema/index";

import { syncPlaidItem } from "../lib/plaid-sync-db";
import { appRouter } from "../routers/index";

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
const USER_ID = "user-manual-category";
const ITEM_ID = "00000000-0000-4000-8000-0000000000a1";
const TXN_ID = "00000000-0000-4000-8000-0000000000f1";
const CAT_ID = "00000000-0000-4000-8000-0000000000c1";
const ADMIN_EMAIL = process.env.ADMIN_EMAILS!.split(",")[0]!.trim();

const render = (clause: unknown) => new PgDialect().sqlToQuery(clause as SQL);

type Calls = Array<[string, unknown[]]>;
let insertCalls: Array<{ table: unknown; calls: Calls }>;
let updateCalls: Array<{ table: unknown; calls: Calls }>;

function selectReturns(rows: unknown[]) {
  mockDb.select.mockReturnValueOnce(makeChain(rows));
}

/** Next db.select() resolves to these rows and records its WHERE clause. */
function selectCapturingWhere(rows: unknown[]): { params: () => unknown[] } {
  const calls: Calls = [];
  mockDb.select.mockReturnValueOnce(makeChain(rows, calls));
  return {
    params: () => {
      const where = calls.find(([m]) => m === "where")?.[1][0];
      return where ? render(where).params : [];
    },
  };
}

function makeCaller() {
  return appRouter.createCaller({ session: { user: { id: USER_ID } } } as any);
}

function makeAdminCaller() {
  return appRouter.createCaller({
    session: { user: { id: "admin-user", email: ADMIN_EMAIL } },
  } as any);
}

/** `set` + rendered WHERE of each update against the transaction table. */
function transactionUpdates() {
  return updateCalls
    .filter((u) => u.table === transaction)
    .map(({ calls }) => {
      const set = calls.find(([m]) => m === "set")?.[1][0] as Record<string, unknown>;
      const where = calls.find(([m]) => m === "where")?.[1][0];
      return { set, where: where ? render(where) : undefined };
    });
}

beforeEach(() => {
  vi.clearAllMocks();
  insertCalls = [];
  updateCalls = [];
  mockDb.insert.mockImplementation((table: unknown) => {
    const calls: Calls = [];
    insertCalls.push({ table, calls });
    return makeChain([], calls);
  });
  mockDb.update.mockImplementation((table: unknown) => {
    const calls: Calls = [];
    updateCalls.push({ table, calls });
    return makeChain([], calls);
  });
  mockDb.transaction.mockImplementation((fn: (tx: unknown) => unknown) => fn(mockDb));
});

// ────────────────────────────────────────────────────────────────────────────
// transactions.setCategory
// ────────────────────────────────────────────────────────────────────────────
describe("transactions.setCategory", () => {
  it("sets the category and marks it manual, scoped to the caller", async () => {
    await makeCaller().transactions.setCategory({ id: TXN_ID, categoryId: CAT_ID });

    const [update] = transactionUpdates();
    expect(update!.set).toEqual({ categoryId: CAT_ID, categoryOverridden: true });
    expect(update!.where!.params).toEqual([TXN_ID, USER_ID]);
  });

  it("treats choosing Uncategorized as a manual choice", async () => {
    await makeCaller().transactions.setCategory({ id: TXN_ID, categoryId: null });

    const [update] = transactionUpdates();
    expect(update!.set).toEqual({ categoryId: null, categoryOverridden: true });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// transactions.resetCategory
// ────────────────────────────────────────────────────────────────────────────
describe("transactions.resetCategory", () => {
  it("restores the Default Category and clears the manual flag, scoped to the caller", async () => {
    const lookup = selectCapturingWhere([{ plaidCategoryPrimary: "FOOD_AND_DRINK" }]);
    const categories = selectCapturingWhere([
      { id: "cat-food", name: "Food & Drink" },
      { id: "cat-shop", name: "Shopping" },
    ]);

    await makeCaller().transactions.resetCategory({ id: TXN_ID });

    expect(lookup.params()).toEqual([TXN_ID, USER_ID]);
    expect(categories.params()).toEqual([USER_ID]);
    const [update] = transactionUpdates();
    expect(update!.set).toEqual({ categoryId: "cat-food", categoryOverridden: false });
    expect(update!.where!.params).toEqual([TXN_ID, USER_ID]);
  });

  it("leaves the transaction uncategorized when the user has no Default Category for it", async () => {
    selectReturns([{ plaidCategoryPrimary: "FOOD_AND_DRINK" }]);
    selectReturns([]); // no seeded categories

    await makeCaller().transactions.resetCategory({ id: TXN_ID });

    const [update] = transactionUpdates();
    expect(update!.set).toEqual({ categoryId: null, categoryOverridden: false });
  });

  it("rejects a transaction the caller doesn't own with NOT_FOUND", async () => {
    selectReturns([]);

    await expect(makeCaller().transactions.resetCategory({ id: TXN_ID })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(transactionUpdates()).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Sync upsert
// ────────────────────────────────────────────────────────────────────────────
describe("syncPlaidItem upsert", () => {
  it("never overwrites categoryId or the manual flag on a modified transaction", async () => {
    selectReturns([{ id: ITEM_ID, userId: USER_ID, accessTokenEnc: "enc", transactionCursor: "c1" }]);
    mockPlaid.transactionsSync.mockResolvedValueOnce({
      data: {
        added: [],
        modified: [
          {
            transaction_id: "plaid-txn-1",
            account_id: "p_chk",
            amount: 12,
            date: "2026-09-30",
            name: "Blue Bottle",
            pending: false,
            personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: null },
          },
        ],
        removed: [],
        accounts: [],
        next_cursor: "c2",
        has_more: false,
      },
    });
    selectReturns([{ id: "fa-chk", plaidAccountId: "p_chk" }]); // accounts
    selectReturns([{ id: "cat-food", name: "Food & Drink" }]); // categories
    selectReturns([]); // category rules
    selectReturns([]); // transfer candidates

    await syncPlaidItem(ITEM_ID);

    const upsert = insertCalls.find((i) => i.table === transaction)!;
    const values = upsert.calls.find(([m]) => m === "values")?.[1][0] as Record<string, unknown>;
    expect(values.categoryId).toBe("cat-food");
    const onConflict = upsert.calls.find(([m]) => m === "onConflictDoUpdate")?.[1][0] as {
      set: Record<string, unknown>;
    };
    expect(onConflict.set).not.toHaveProperty("categoryId");
    expect(onConflict.set).not.toHaveProperty("categoryOverridden");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// admin.backfillManualCategories
// ────────────────────────────────────────────────────────────────────────────
describe("admin.backfillManualCategories", () => {
  it("flags rows whose category differs from their Default Category, per user", async () => {
    selectReturns([
      { id: "t-default", userId: "u1", categoryId: "u1-food", plaidCategoryPrimary: "FOOD_AND_DRINK" },
      { id: "t-moved", userId: "u1", categoryId: "u1-shop", plaidCategoryPrimary: "FOOD_AND_DRINK" },
      { id: "t-cleared", userId: "u1", categoryId: null, plaidCategoryPrimary: "FOOD_AND_DRINK" },
      // Same category name, different user: must use u2's own category ids.
      { id: "t-other-user", userId: "u2", categoryId: "u2-food", plaidCategoryPrimary: "FOOD_AND_DRINK" },
    ]);
    selectReturns([
      { id: "u1-food", userId: "u1", name: "Food & Drink" },
      { id: "u1-shop", userId: "u1", name: "Shopping" },
      { id: "u2-food", userId: "u2", name: "Food & Drink" },
    ]);

    const result = await makeAdminCaller().admin.backfillManualCategories();

    expect(result).toEqual({ processed: 4, manual: 2 });
    const [update] = transactionUpdates();
    expect(update!.set).toEqual({ categoryOverridden: true });
    expect(update!.where!.params).toEqual(["t-moved", "t-cleared"]);
  });

  it("writes nothing when no row is manual", async () => {
    selectReturns([
      { id: "t-default", userId: "u1", categoryId: "u1-food", plaidCategoryPrimary: "FOOD_AND_DRINK" },
    ]);
    selectReturns([{ id: "u1-food", userId: "u1", name: "Food & Drink" }]);

    const result = await makeAdminCaller().admin.backfillManualCategories();

    expect(result).toEqual({ processed: 1, manual: 0 });
    expect(transactionUpdates()).toEqual([]);
  });

  it("is admin-only", async () => {
    await expect(makeCaller().admin.backfillManualCategories()).rejects.toMatchObject({
      code: expect.stringMatching(/UNAUTHORIZED|FORBIDDEN/),
    });
  });
});
