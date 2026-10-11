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
const { mockPlaid } = vi.hoisted(() => ({ mockPlaid: { transactionsSync: vi.fn() } }));

vi.mock("@life-tracker/db", () => import("./helpers/mock-db").then((m) => m.mockDbModule));
vi.mock("../lib/token-encryption", () => ({
  decryptToken: (enc: string) => `access-${enc}`,
}));
vi.mock("../lib/plaid-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/plaid-client")>()),
  getPlaidClient: () => mockPlaid,
  getTokenEncryptionKey: () =>
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
}));

import {
  category,
  categoryRule,
  financialAccount,
  plaidItem,
  transaction,
} from "@life-tracker/db/schema/index";

import { syncPlaidItem } from "../lib/plaid-sync-db";
import { appRouter } from "../routers/index";
import { env } from "@life-tracker/env/server";
import { mockDb } from "./helpers/mock-db";

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
const USER_ID = "user-manual-category";
const ITEM_ID = "00000000-0000-4000-8000-0000000000a1";
const TXN_ID = "00000000-0000-4000-8000-0000000000f1";
const CAT_ID = "00000000-0000-4000-8000-0000000000c1";
const ADMIN_EMAIL = process.env.ADMIN_EMAILS!.split(",")[0]!.trim();

function makeCaller() {
  return appRouter.createCaller({ session: { user: { id: USER_ID } } } as any);
}

function makeAdminCaller() {
  return appRouter.createCaller({
    session: { user: { id: "admin-user", email: ADMIN_EMAIL } },
  } as any);
}

/** `{ set, where }` of each update against the transaction table; `where` is its params. */
const transactionUpdates = () =>
  mockDb.updated(transaction) as Array<{ set: Record<string, unknown>; where: unknown[] }>;

beforeEach(() => {
  vi.clearAllMocks();
});

// ────────────────────────────────────────────────────────────────────────────
// transactions.setCategory
// ────────────────────────────────────────────────────────────────────────────
describe("transactions.setCategory", () => {
  it("sets the category and marks it manual, scoped to the caller", async () => {
    await makeCaller().transactions.setCategory({ id: TXN_ID, categoryId: CAT_ID });

    const [update] = transactionUpdates();
    expect(update!.set).toEqual({ categoryId: CAT_ID, categoryOverridden: true });
    expect(update!.where).toEqual([TXN_ID, USER_ID]);
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
    mockDb.onSelect(transaction, [{ name: "BLUE BOTTLE", plaidCategoryPrimary: "FOOD_AND_DRINK" }]);
    mockDb.onSelect(category, [
      { id: "cat-food", name: "Food & Drink" },
      { id: "cat-shop", name: "Shopping" },
    ]);

    await makeCaller().transactions.resetCategory({ id: TXN_ID });

    expect(mockDb.selected(transaction)).toEqual([[TXN_ID, USER_ID]]);
    expect(mockDb.selected(categoryRule)).toEqual([[USER_ID]]);
    expect(mockDb.selected(category)).toEqual([[USER_ID]]);
    const [update] = transactionUpdates();
    expect(update!.set).toEqual({ categoryId: "cat-food", categoryOverridden: false });
    expect(update!.where).toEqual([TXN_ID, USER_ID]);
  });

  it("leaves the transaction uncategorized when the user has no Default Category for it", async () => {
    mockDb.onSelect(transaction, [{ name: "BLUE BOTTLE", plaidCategoryPrimary: "FOOD_AND_DRINK" }]);
    // No rules, no seeded categories: nothing queued.

    await makeCaller().transactions.resetCategory({ id: TXN_ID });

    const [update] = transactionUpdates();
    expect(update!.set).toEqual({ categoryId: null, categoryOverridden: false });
  });

  it("applies the matching Category Rule before the Default Category", async () => {
    mockDb.onSelect(transaction, [{ name: "SQ *BLUE BOTTLE", plaidCategoryPrimary: "FOOD_AND_DRINK" }]);
    mockDb.onSelect(categoryRule, [
      { id: "r1", pattern: "blue bottle", categoryId: "cat-coffee", createdAt: new Date() },
    ]);
    mockDb.onSelect(category, [{ id: "cat-food", name: "Food & Drink" }]);

    await makeCaller().transactions.resetCategory({ id: TXN_ID });

    const [update] = transactionUpdates();
    expect(update!.set).toEqual({ categoryId: "cat-coffee", categoryOverridden: false });
  });

  it("rejects a transaction the caller doesn't own with NOT_FOUND", async () => {
    // Nothing queued: the lookup finds no transaction.
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
    mockDb.onSelect(plaidItem, [
      { id: ITEM_ID, userId: USER_ID, accessTokenEnc: "enc", transactionCursor: "c1", plaidEnv: env.PLAID_ENV },
    ]);
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
    mockDb.onSelect(financialAccount, [{ id: "fa-chk", plaidAccountId: "p_chk" }]);
    mockDb.onSelect(category, [{ id: "cat-food", name: "Food & Drink" }]);

    await syncPlaidItem(ITEM_ID);

    const upsert = mockDb.opsOn(transaction, "insert")[0]!;
    const values = upsert.arg("values") as Record<string, unknown>;
    expect(values.categoryId).toBe("cat-food");
    const onConflict = upsert.arg("onConflictDoUpdate") as {
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
    mockDb.onSelect(transaction, [
      { id: "t-default", userId: "u1", categoryId: "u1-food", plaidCategoryPrimary: "FOOD_AND_DRINK" },
      { id: "t-moved", userId: "u1", categoryId: "u1-shop", plaidCategoryPrimary: "FOOD_AND_DRINK" },
      { id: "t-cleared", userId: "u1", categoryId: null, plaidCategoryPrimary: "FOOD_AND_DRINK" },
      // Same category name, different user: must use u2's own category ids.
      { id: "t-other-user", userId: "u2", categoryId: "u2-food", plaidCategoryPrimary: "FOOD_AND_DRINK" },
    ]);
    mockDb.onSelect(category, [
      { id: "u1-food", userId: "u1", name: "Food & Drink" },
      { id: "u1-shop", userId: "u1", name: "Shopping" },
      { id: "u2-food", userId: "u2", name: "Food & Drink" },
    ]);

    const result = await makeAdminCaller().admin.backfillManualCategories();

    expect(result).toEqual({ processed: 4, manual: 2 });
    const [update] = transactionUpdates();
    expect(update!.set).toEqual({ categoryOverridden: true });
    expect(update!.where).toEqual(["t-moved", "t-cleared"]);
  });

  it("writes nothing when no row is manual", async () => {
    mockDb.onSelect(transaction, [
      { id: "t-default", userId: "u1", categoryId: "u1-food", plaidCategoryPrimary: "FOOD_AND_DRINK" },
    ]);
    mockDb.onSelect(category, [{ id: "u1-food", userId: "u1", name: "Food & Drink" }]);

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
