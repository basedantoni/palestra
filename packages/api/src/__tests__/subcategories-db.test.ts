/**
 * Parent Categories and Subcategories against a real Postgres (PGlite, KOI-337).
 *
 * - categories.update sets or clears `parentId`, keeping the tree two levels
 *   deep and inside the caller's own categories
 * - categories.list returns the tree: each parent followed by its
 *   Subcategories, which render as tints of the parent's color
 * - deleting a parent promotes its Subcategories, in the parent's color
 * - budgets and the Card Fund roll Subcategory spend into the parent
 */
import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@life-tracker/db", () => import("./helpers/pglite").then((m) => m.pgliteDbModule()));

import { db } from "@life-tracker/db";
import { budget, category, tcgSettings, transaction } from "@life-tracker/db/schema/index";
import { eq } from "drizzle-orm";

import { appRouter } from "../routers/index";
import { seedFinanceUser, truncateAll } from "./helpers/pglite";

const USER = "user-pglite-subcategories";
const OTHER_USER = "user-pglite-subcategories-other";

const makeCaller = (userId = USER) => appRouter.createCaller({ session: { user: { id: userId } } } as any);

async function addCategory(name: string, extra: Partial<typeof category.$inferInsert> = {}, userId = USER) {
  const id = randomUUID();
  await db.insert(category).values({ id, userId, name, ...extra });
  return id;
}

/** A September 2026 expense in `categoryId`, on the seeded account. */
async function spend(categoryId: string, amount: number) {
  const [{ accountId }] = (await db
    .select({ accountId: transaction.accountId })
    .from(transaction)
    .where(eq(transaction.id, seeded.transactionId))) as [{ accountId: string }];
  const id = randomUUID();
  await db.insert(transaction).values({
    id,
    userId: USER,
    accountId,
    plaidTransactionId: `txn-${id}`,
    amount,
    date: new Date("2026-09-20T00:00:00.000Z"),
    name: "FIXTURE",
    flow: "expense",
    categoryId,
  });
}

const setBudget = (categoryId: string, limitAmount: number, monthKey = "2026-09") =>
  db.insert(budget).values({ id: randomUUID(), userId: USER, categoryId, monthKey, limitAmount });

const parentOf = async (id: string) =>
  (await db.select({ parentId: category.parentId }).from(category).where(eq(category.id, id)))[0]!.parentId;

/** The user's "Climbing" category (sortOrder 0) and its one transaction. */
let seeded: Awaited<ReturnType<typeof seedFinanceUser>>;

beforeEach(async () => {
  await truncateAll(db);
  seeded = await seedFinanceUser(db, USER);
});

describe("categories.update parentId", () => {
  it("files a category under a parent, and the list shows it under that parent in a tint of its color", async () => {
    const fun = await addCategory("Entertainment", { color: "blue", sortOrder: 1 });
    const golf = await addCategory("Golf", { color: "orange", sortOrder: 2 });
    await addCategory("Travel", { color: "aqua", sortOrder: 3 });

    await makeCaller().categories.update({ id: golf, parentId: fun });

    const list = await makeCaller().categories.list();
    expect(list.map((c) => [c.name, c.parentId, c.color, c.tint])).toEqual([
      ["Climbing", null, null, null],
      ["Entertainment", null, "blue", null],
      ["Golf", fun, "blue", 24],
      ["Travel", null, "aqua", null],
    ]);
  });

  it("moves a Subcategory back to top level in its old parent's color", async () => {
    const fun = await addCategory("Entertainment", { color: "blue" });
    const golf = await addCategory("Golf", { parentId: fun });

    await makeCaller().categories.update({ id: golf, parentId: null });

    const [row] = await db.select().from(category).where(eq(category.id, golf));
    expect(row).toMatchObject({ parentId: null, color: "blue" });
  });

  it("moves a Subcategory back to top level in a color given with the move", async () => {
    const fun = await addCategory("Entertainment", { color: "blue" });
    const golf = await addCategory("Golf", { parentId: fun });

    await makeCaller().categories.update({ id: golf, parentId: null, color: "green" });

    const [row] = await db.select().from(category).where(eq(category.id, golf));
    expect(row).toMatchObject({ parentId: null, color: "green" });
  });

  it("refuses a parent that is itself a Subcategory", async () => {
    const fun = await addCategory("Entertainment");
    const golf = await addCategory("Golf", { parentId: fun });
    const putting = await addCategory("Putting");

    await expect(makeCaller().categories.update({ id: putting, parentId: golf })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "A Subcategory can't have Subcategories",
    });
    expect(await parentOf(putting)).toBeNull();
  });

  it("refuses to move a category with Subcategories under another", async () => {
    const fun = await addCategory("Entertainment");
    await addCategory("Golf", { parentId: fun });
    const leisure = await addCategory("Leisure");

    await expect(makeCaller().categories.update({ id: fun, parentId: leisure })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "A category with Subcategories can't be moved under another",
    });
    expect(await parentOf(fun)).toBeNull();
  });

  it("refuses a category as its own parent", async () => {
    const fun = await addCategory("Entertainment");

    await expect(makeCaller().categories.update({ id: fun, parentId: fun })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("refuses another user's category as the parent", async () => {
    await seedFinanceUser(db, OTHER_USER);
    const theirs = await addCategory("Entertainment", {}, OTHER_USER);
    const golf = await addCategory("Golf");

    await expect(makeCaller().categories.update({ id: golf, parentId: theirs })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await parentOf(golf)).toBeNull();
  });

  it("refuses a color for a Subcategory", async () => {
    const fun = await addCategory("Entertainment", { color: "blue" });
    const golf = await addCategory("Golf", { parentId: fun });

    await expect(makeCaller().categories.update({ id: golf, color: "red" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "A Subcategory takes its parent's color",
    });
  });
});

describe("categories.remove on a Parent Category", () => {
  it("promotes its Subcategories to top level in its color; its own transactions still move", async () => {
    const climbing = seeded.categoryId;
    await db.update(category).set({ color: "violet" }).where(eq(category.id, climbing));
    const bouldering = await addCategory("Bouldering", { parentId: climbing });
    const target = await addCategory("Sport", { color: "green" });

    await makeCaller().categories.remove({ id: climbing, moveToCategoryId: target });

    const [promoted] = await db.select().from(category).where(eq(category.id, bouldering));
    expect(promoted).toMatchObject({ parentId: null, color: "violet" });
    const list = await makeCaller().categories.list();
    expect(list.find((c) => c.id === target)?.transactionCount).toBe(1);
  });
});

/** Entertainment ($10 own spend) with Golf ($120) under it, both budgeted; Climbing ($42 seeded) too. */
async function seedEntertainment() {
  const fun = await addCategory("Entertainment", { color: "blue", sortOrder: 1 });
  const golf = await addCategory("Golf", { parentId: fun, sortOrder: 2 });
  await spend(fun, 10);
  await spend(golf, 120);
  await setBudget(fun, 200);
  await setBudget(golf, 150);
  await setBudget(seeded.categoryId, 50);
  return { fun, golf };
}

describe("budgets with Subcategories", () => {
  it("forMonth rolls Subcategory spend into the parent and totals without double-counting", async () => {
    const { fun, golf } = await seedEntertainment();

    const { categories, total } = await makeCaller().budgets.forMonth({ monthKey: "2026-09" });

    expect(categories.map((r) => [r.categoryName, r.parentId, r.limit, r.spent, r.overspent])).toEqual([
      ["Climbing", null, 50, 42, false],
      ["Entertainment", null, 200, 130, false],
      ["Golf", fun, 150, 120, false],
    ]);
    expect(categories.find((r) => r.categoryId === golf)).toMatchObject({ color: "blue", tint: 24 });
    // Climbing 50 + Entertainment 200; Golf's 150 sits inside Entertainment's.
    expect(total).toEqual({ limitAmount: 250, spent: 172 });
  });

  it("history includes a parent's Subcategories' spend", async () => {
    const { fun } = await seedEntertainment();

    const history = await makeCaller().budgets.history({ categoryId: fun, monthKey: "2026-10", months: 2 });

    expect(history).toEqual([
      { monthKey: "2026-09", spent: 130, limit: 200 },
      { monthKey: "2026-10", spent: 0, limit: null },
    ]);
  });

  describe("Card Fund", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-25T18:00:00Z"));
    });
    afterEach(() => vi.useRealTimers());

    it("counts spend in the Cards category's Subcategories", async () => {
      const { fun } = await seedEntertainment();
      await db.insert(tcgSettings).values({ userId: USER, cardsCategoryId: fun, startMonth: "2026-09" });

      const { fund } = await makeCaller().tcg.fund.get();

      expect(fund).toMatchObject({ balance: 70, thisMonth: { limit: 200, spent: 130 } });
    });
  });
});
