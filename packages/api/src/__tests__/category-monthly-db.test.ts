/**
 * finance.categoryMonthly against a real Postgres (PGlite, KOI-347).
 *
 * - a Parent Category's months roll up its Subcategories', skipping Excluded
 *   rows and split parents (counting their Splits), with each month's limit
 * - the months end at the current month
 * - another user's category is not found
 * - the transaction filters can take a parent with its Subcategories
 */
import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@life-tracker/db", () => import("./helpers/pglite").then((m) => m.pgliteDbModule()));

import { db } from "@life-tracker/db";
import { budget, category, transaction } from "@life-tracker/db/schema/index";
import { eq } from "drizzle-orm";

import { appRouter } from "../routers/index";
import { seedFinanceUser, truncateAll } from "./helpers/pglite";

const USER = "user-pglite-category-monthly";

const makeCaller = (userId = USER) => appRouter.createCaller({ session: { user: { id: userId } } } as any);

/** The user's "Climbing" category and its $42 expense on September 15. */
let seeded: Awaited<ReturnType<typeof seedFinanceUser>>;
let accountId: string;

beforeEach(async () => {
  await truncateAll(db);
  seeded = await seedFinanceUser(db, USER);
  const [row] = await db.select({ accountId: transaction.accountId }).from(transaction).where(eq(transaction.id, seeded.transactionId));
  accountId = row!.accountId;
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-26T18:00:00.000Z") });
});

afterEach(() => {
  vi.useRealTimers();
});

async function addTransaction(date: string, amount: number, over: Partial<typeof transaction.$inferInsert> = {}) {
  const id = randomUUID();
  await db.insert(transaction).values({
    id,
    userId: USER,
    accountId,
    amount,
    date: new Date(`${date}T00:00:00.000Z`),
    name: `TXN ${id}`,
    flow: "expense",
    categoryId: seeded.categoryId,
    ...over,
  });
  return id;
}

async function addSubcategory(name: string) {
  const id = randomUUID();
  await db.insert(category).values({ id, userId: USER, name, parentId: seeded.categoryId });
  return id;
}

describe("finance.categoryMonthly", () => {
  it("rolls a parent's Subcategories into its months, counting only what counts in totals", async () => {
    const gymFees = await addSubcategory("Gym fees");
    await addTransaction("2026-09-03", 10, { categoryId: gymFees });
    await addTransaction("2026-09-05", 100, { excluded: true });
    // A split parent that kept its category: only its Splits count.
    const parent = await addTransaction("2026-10-20", 50);
    await addTransaction("2026-10-20", 30, { parentTransactionId: parent });
    await addTransaction("2026-10-20", 20, { parentTransactionId: parent, categoryId: gymFees });
    await addTransaction("2026-10-22", 500, { categoryId: null });
    await db.insert(budget).values({ id: randomUUID(), userId: USER, categoryId: seeded.categoryId, monthKey: "2026-09", limitAmount: 80 });

    const months = await makeCaller().finance.categoryMonthly({ categoryId: seeded.categoryId, months: 3 });

    expect(months).toEqual([
      { monthKey: "2026-08", spent: 0, limit: null },
      { monthKey: "2026-09", spent: 52, limit: 80 },
      { monthKey: "2026-10", spent: 50, limit: null },
    ]);

    const subcategory = await makeCaller().finance.categoryMonthly({ categoryId: gymFees, months: 2 });
    expect(subcategory.map((m) => m.spent)).toEqual([10, 20]);
  });

  it("doesn't find another user's category", async () => {
    await seedFinanceUser(db, "someone-else");

    await expect(
      makeCaller("someone-else").finance.categoryMonthly({ categoryId: seeded.categoryId, months: 6 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("transaction filters with Subcategories", () => {
  it("counts a parent's Subcategories' transactions alongside its own", async () => {
    const gymFees = await addSubcategory("Gym fees");
    await addTransaction("2026-09-03", 10, { categoryId: gymFees });
    await addTransaction("2026-09-04", 7, { categoryId: null });

    const caller = makeCaller();
    const own = await caller.transactions.summary({ categoryId: seeded.categoryId });
    const withSubcategories = await caller.transactions.summary({ categoryId: seeded.categoryId, subcategories: true });

    expect(own).toEqual({ count: 1, spent: 42 });
    expect(withSubcategories).toEqual({ count: 2, spent: 52 });
  });
});
