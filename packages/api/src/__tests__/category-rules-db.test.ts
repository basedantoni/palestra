/**
 * Category Rules against a real Postgres (PGlite, KOI-296): the constraints the
 * mocked suites can only assume.
 *
 * - category_rule's unique index is on (user_id, lower(pattern)): a second rule
 *   differing only in case is rejected, per user
 * - deleting a category cascades to its rules, while its transactions become
 *   Uncategorized (or move to the target category first)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@life-tracker/db", () => import("./helpers/pglite").then((m) => m.pgliteDbModule()));

import { db } from "@life-tracker/db";
import { category, categoryRule, transaction } from "@life-tracker/db/schema/index";
import { eq } from "drizzle-orm";

import { appRouter } from "../routers/index";
import { seedFinanceUser, truncateAll } from "./helpers/pglite";

const USER = "user-pglite-rules";
const OTHER_USER = "user-pglite-other";

const makeCaller = (userId = USER) => appRouter.createCaller({ session: { user: { id: userId } } } as any);

/** The Postgres error code under drizzle's wrapper (`err.cause.code`). */
async function pgErrorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (err) {
    return (err as { cause?: { code?: string } }).cause?.code;
  }
}

beforeEach(async () => {
  await truncateAll(db);
});

describe("category_rule unique index (user_id, lower(pattern))", () => {
  it("rejects a second rule whose pattern differs only in case", async () => {
    const { categoryId } = await seedFinanceUser(db, USER);
    await db.insert(categoryRule).values({ id: crypto.randomUUID(), userId: USER, pattern: "Starbucks", categoryId });

    const duplicate = db
      .insert(categoryRule)
      .values({ id: crypto.randomUUID(), userId: USER, pattern: "STARBUCKS", categoryId });

    expect(await pgErrorCode(duplicate)).toBe("23505"); // unique_violation
  });

  it("allows the same pattern for a different user", async () => {
    const mine = await seedFinanceUser(db, USER);
    const theirs = await seedFinanceUser(db, OTHER_USER);
    await db
      .insert(categoryRule)
      .values({ id: crypto.randomUUID(), userId: USER, pattern: "starbucks", categoryId: mine.categoryId });

    await db
      .insert(categoryRule)
      .values({ id: crypto.randomUUID(), userId: OTHER_USER, pattern: "starbucks", categoryId: theirs.categoryId });

    expect(await db.select().from(categoryRule)).toHaveLength(2);
  });
});

describe("categories.remove", () => {
  it("deletes the category's rules and leaves its transactions Uncategorized", async () => {
    const { categoryId, transactionId } = await seedFinanceUser(db, USER);
    await db.insert(categoryRule).values({ id: crypto.randomUUID(), userId: USER, pattern: "climb", categoryId });

    await makeCaller().categories.remove({ id: categoryId });

    expect(await db.select().from(category).where(eq(category.id, categoryId))).toEqual([]);
    expect(await db.select().from(categoryRule)).toEqual([]);
    const [txn] = await db.select().from(transaction).where(eq(transaction.id, transactionId));
    expect(txn!.categoryId).toBeNull();
  });

  it("moves transactions to the target, but the deleted category's rules still go", async () => {
    const { categoryId, transactionId } = await seedFinanceUser(db, USER);
    const targetId = crypto.randomUUID();
    await db.insert(category).values({ id: targetId, userId: USER, name: "Bouldering" });
    await db.insert(categoryRule).values({ id: crypto.randomUUID(), userId: USER, pattern: "climb", categoryId });

    await makeCaller().categories.remove({ id: categoryId, moveToCategoryId: targetId });

    const [txn] = await db.select().from(transaction).where(eq(transaction.id, transactionId));
    expect(txn!.categoryId).toBe(targetId);
    expect(await db.select().from(categoryRule)).toEqual([]);
  });
});
