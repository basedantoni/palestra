/**
 * Bank Category mapping against a real Postgres (PGlite, KOI-335).
 *
 * - bank_category_mapping is unique per (user, Bank Category)
 * - deleting a mapped category, seeded ones included, leaves the Bank Category
 *   unmapped (ON DELETE SET NULL) instead of deleting the mapping row
 * - seeded categories can be renamed; the mapping still points at them
 * - admin.backfillBankCategoryMappings maps existing users by name, idempotently
 * - before that backfill, a user with categories but no mapping gets it backfilled
 *   by name on first read: sync never re-creates a seeded category they renamed
 *   or deleted, and reset resolves to the Default Category
 */
import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPlaid } = vi.hoisted(() => ({
  mockPlaid: { accountsGet: vi.fn(), transactionsSync: vi.fn() },
}));

vi.mock("@life-tracker/db", () => import("./helpers/pglite").then((m) => m.pgliteDbModule()));
vi.mock("../lib/token-encryption", () => ({ decryptToken: (enc: string) => enc }));
vi.mock("../lib/plaid-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/plaid-client")>()),
  getPlaidClient: () => mockPlaid,
  getTokenEncryptionKey: () => "key",
}));

import { db } from "@life-tracker/db";
import { bankCategoryMapping, category, plaidItem, transaction, user } from "@life-tracker/db/schema/index";
import { env } from "@life-tracker/env/server";
import { eq } from "drizzle-orm";

import { PFC_PRIMARIES, SEED_CATEGORIES } from "../lib/category-seed";
import { syncPlaidItem } from "../lib/plaid-sync-db";
import { appRouter } from "../routers/index";
import { PG_UNIQUE_VIOLATION, seedFinanceUser, truncateAll } from "./helpers/pglite";

const USER = "user-pglite-bank-categories";

const makeCaller = () => appRouter.createCaller({ session: { user: { id: USER } } } as any);

async function pgErrorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (err) {
    return (err as { cause?: { code?: string } }).cause?.code;
  }
}

/** A seeded (isSystem) category mapped from FOOD_AND_DRINK. */
async function seedMappedCategory() {
  await seedFinanceUser(db, USER);
  const categoryId = randomUUID();
  await db.insert(category).values({ id: categoryId, userId: USER, name: "Food & Drink", isSystem: true });
  await db.insert(bankCategoryMapping).values({ userId: USER, pfcPrimary: "FOOD_AND_DRINK", categoryId });
  return categoryId;
}

const mappingRows = () => db.select().from(bankCategoryMapping).where(eq(bankCategoryMapping.userId, USER));

beforeEach(async () => {
  await truncateAll(db);
});

describe("bank_category_mapping", () => {
  it("allows one mapping per Bank Category per user", async () => {
    const categoryId = await seedMappedCategory();

    expect(
      await pgErrorCode(db.insert(bankCategoryMapping).values({ userId: USER, pfcPrimary: "FOOD_AND_DRINK", categoryId })),
    ).toBe(PG_UNIQUE_VIOLATION);
  });

  it("leaves the Bank Category unmapped when its seeded category is deleted", async () => {
    const categoryId = await seedMappedCategory();

    await makeCaller().categories.remove({ id: categoryId });

    expect(await db.select().from(category).where(eq(category.id, categoryId))).toEqual([]);
    expect(await mappingRows()).toMatchObject([{ pfcPrimary: "FOOD_AND_DRINK", categoryId: null }]);
  });

  it("keeps the mapping on a renamed seeded category", async () => {
    const categoryId = await seedMappedCategory();

    await makeCaller().categories.update({ id: categoryId, name: "Dining" });

    const [renamed] = await db.select().from(category).where(eq(category.id, categoryId));
    expect(renamed!.name).toBe("Dining");
    expect(await mappingRows()).toMatchObject([{ pfcPrimary: "FOOD_AND_DRINK", categoryId }]);
  });
});

describe("admin.backfillBankCategoryMappings", () => {
  const ADMIN_EMAIL = process.env.ADMIN_EMAILS!.split(",")[0]!.trim();
  const adminCaller = () =>
    appRouter.createCaller({ session: { user: { id: "admin-user", email: ADMIN_EMAIL } } } as any);

  it("maps every Bank Category of each existing user by name, and is idempotent", async () => {
    await seedFinanceUser(db, USER);
    const foodId = randomUUID();
    await db.insert(category).values({ id: foodId, userId: USER, name: "Food & Drink", isSystem: true });

    const first = await adminCaller().admin.backfillBankCategoryMappings();
    const second = await adminCaller().admin.backfillBankCategoryMappings();

    expect(first).toEqual({ users: 1 });
    expect(second).toEqual({ users: 1 });
    const rows = await mappingRows();
    expect(rows).toHaveLength(PFC_PRIMARIES.length);
    expect(rows.find((r) => r.pfcPrimary === "FOOD_AND_DRINK")!.categoryId).toBe(foodId);
    // The fixture user has no "Travel" category: left unmapped.
    expect(rows.find((r) => r.pfcPrimary === "TRAVEL")!.categoryId).toBeNull();
  });

  it("keeps a mapping the user already chose", async () => {
    const climbingId = (await seedFinanceUser(db, USER)).categoryId;
    await db.insert(category).values({ id: randomUUID(), userId: USER, name: "Food & Drink" });
    await db.insert(bankCategoryMapping).values({ userId: USER, pfcPrimary: "FOOD_AND_DRINK", categoryId: climbingId });

    await adminCaller().admin.backfillBankCategoryMappings();

    const rows = await mappingRows();
    expect(rows.find((r) => r.pfcPrimary === "FOOD_AND_DRINK")!.categoryId).toBe(climbingId);
  });
});

/** Seeded categories, as a pre-KOI-335 user has them, and no mapping rows. */
async function seedPreBackfillUser() {
  await seedFinanceUser(db, USER);
  const ids = new Map(SEED_CATEGORIES.map((name) => [name, randomUUID()]));
  await db.insert(category).values([...ids].map(([name, id]) => ({ id, userId: USER, name, isSystem: true })));
  return ids;
}

/** Sync the user's item against a bank holding one new FOOD_AND_DRINK transaction; returns it. */
async function syncNewFoodTransaction() {
  const [item] = await db
    .update(plaidItem)
    .set({ plaidEnv: env.PLAID_ENV })
    .where(eq(plaidItem.userId, USER))
    .returning();
  mockPlaid.accountsGet.mockResolvedValue({ data: { item: { institution_id: null }, accounts: [] } });
  mockPlaid.transactionsSync.mockResolvedValue({
    data: {
      added: [
        {
          transaction_id: "txn-new-food",
          account_id: `acct-${USER}`,
          amount: 12,
          date: "2026-10-01",
          name: "CORNER CAFE",
          pending: false,
          personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_COFFEE" },
          iso_currency_code: "USD",
        },
      ],
      modified: [],
      removed: [],
      next_cursor: "cursor-1",
      has_more: false,
    },
  });
  await syncPlaidItem(item!.id);
  const [synced] = await db.select().from(transaction).where(eq(transaction.plaidTransactionId, "txn-new-food"));
  return synced!;
}

const categoryNames = async () =>
  (await db.select({ name: category.name }).from(category).where(eq(category.userId, USER))).map((c) => c.name);

describe("a user with categories but no mapping yet (before the backfill)", () => {
  it("doesn't re-create a renamed seeded category on sync, and maps the rest by name", async () => {
    const ids = await seedPreBackfillUser();
    await makeCaller().categories.update({ id: ids.get("Food & Drink")!, name: "Dining" });

    await syncNewFoodTransaction();

    const names = await categoryNames();
    expect(names).toContain("Dining");
    expect(names).not.toContain("Food & Drink");
    const rows = await mappingRows();
    expect(rows).toHaveLength(PFC_PRIMARIES.length);
    expect(rows.find((r) => r.pfcPrimary === "TRAVEL")!.categoryId).toBe(ids.get("Travel"));
  });

  it("doesn't re-create a deleted seeded category on sync", async () => {
    const ids = await seedPreBackfillUser();
    await makeCaller().categories.remove({ id: ids.get("Food & Drink")! });

    const synced = await syncNewFoodTransaction();

    expect(await categoryNames()).not.toContain("Food & Drink");
    expect(synced.categoryId).toBeNull();
  });

  it("resets a Manual Category to the Default Category", async () => {
    const ids = await seedPreBackfillUser();
    const [txn] = await db
      .update(transaction)
      .set({ plaidCategoryPrimary: "FOOD_AND_DRINK", categoryOverridden: true })
      .where(eq(transaction.userId, USER))
      .returning();

    await makeCaller().transactions.resetCategory({ id: txn!.id });

    const [reset] = await db.select().from(transaction).where(eq(transaction.id, txn!.id));
    expect(reset).toMatchObject({ categoryId: ids.get("Food & Drink"), categoryOverridden: false });
  });

  it("seeds every category for a user who has none", async () => {
    await db.insert(user).values({ id: USER, name: USER, email: `${USER}@test.internal` });

    const list = await makeCaller().bankCategories.list();

    expect((await categoryNames()).toSorted()).toEqual(SEED_CATEGORIES.toSorted());
    // Income and transfers carry no category (KOI-341); every spend Bank Category is mapped.
    expect(list.filter((b) => b.categoryId === null).map((b) => b.bankCategory).toSorted()).toEqual([
      "INCOME",
      "TRANSFER_IN",
      "TRANSFER_OUT",
    ]);
  });
});
