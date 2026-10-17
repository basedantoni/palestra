/**
 * Bank Category mapping against a real Postgres (PGlite, KOI-335).
 *
 * - bank_category_mapping is unique per (user, PFC primary)
 * - deleting a mapped category, seeded ones included, leaves the Bank Category
 *   unmapped (ON DELETE SET NULL) instead of deleting the mapping row
 * - seeded categories can be renamed; the mapping still points at them
 * - admin.backfillBankCategoryMappings maps existing users by name, idempotently
 */
import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@life-tracker/db", () => import("./helpers/pglite").then((m) => m.pgliteDbModule()));

import { db } from "@life-tracker/db";
import { bankCategoryMapping, category } from "@life-tracker/db/schema/index";
import { eq } from "drizzle-orm";

import { PFC_PRIMARIES } from "../lib/category-seed";
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

    await makeCaller().categories.rename({ id: categoryId, name: "Dining" });

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
