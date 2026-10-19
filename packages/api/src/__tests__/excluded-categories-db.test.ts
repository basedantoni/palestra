/**
 * Excluded Categories against a real Postgres (PGlite, KOI-338).
 *
 * - `countsInTotals` leaves out a transaction excluded by hand, one in an
 *   Excluded Category, and one in a Subcategory of an excluded parent
 * - categories.update sets `excluded`; categories.list returns it
 * - the finance charts and the feed summary drop an Excluded Category's spend
 */
import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@life-tracker/db", () => import("./helpers/pglite").then((m) => m.pgliteDbModule()));

import { db } from "@life-tracker/db";
import { category, transaction } from "@life-tracker/db/schema/index";
import { eq } from "drizzle-orm";

import { countsInTotals } from "../lib/counts-in-totals-sql";
import { appRouter } from "../routers/index";
import { seedFinanceUser, truncateAll } from "./helpers/pglite";

const USER = "user-pglite-excluded-categories";

const makeCaller = () => appRouter.createCaller({ session: { user: { id: USER } } } as any);

async function addCategory(name: string, extra: Partial<typeof category.$inferInsert> = {}) {
  const id = randomUUID();
  await db.insert(category).values({ id, userId: USER, name, ...extra });
  return id;
}

/** An expense on the seeded account, in `categoryId`. */
async function spend(name: string, amount: number, categoryId: string | null, extra: Partial<typeof transaction.$inferInsert> = {}) {
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
    name,
    flow: "expense",
    categoryId,
    ...extra,
  });
}

/** The user's "Climbing" category and its one $42 September transaction. */
let seeded: Awaited<ReturnType<typeof seedFinanceUser>>;

beforeEach(async () => {
  await truncateAll(db);
  seeded = await seedFinanceUser(db, USER);
});

describe("countsInTotals", () => {
  it("counts normal and uncategorized rows, not ones excluded by hand, by category, or by parent", async () => {
    const work = await addCategory("Business", { excluded: true });
    const travel = await addCategory("Work travel", { parentId: work });
    await spend("BY HAND", 1, seeded.categoryId, { excluded: true });
    await spend("EXCLUDED CATEGORY", 2, work);
    await spend("EXCLUDED PARENT", 3, travel);
    await spend("UNCATEGORIZED", 4, null);

    const rows = await db.select({ name: transaction.name, counts: countsInTotals }).from(transaction);

    expect(Object.fromEntries(rows.map((r) => [r.name, r.counts]))).toEqual({
      "MOVEMENT CLIMBING GYM": true,
      "BY HAND": false,
      "EXCLUDED CATEGORY": false,
      "EXCLUDED PARENT": false,
      UNCATEGORIZED: true,
    });
  });
});

describe("categories.update excluded", () => {
  it("excludes a category, and the list shows it and its Subcategories as excluded", async () => {
    await addCategory("Work travel", { parentId: seeded.categoryId });

    await makeCaller().categories.update({ id: seeded.categoryId, excluded: true });

    const list = await makeCaller().categories.list();
    expect(list.map((c) => [c.name, c.excluded, c.excludedByParent])).toEqual([
      ["Climbing", true, false],
      ["Work travel", false, true],
    ]);
  });
});

describe("totals", () => {
  it("drop an Excluded Category's spend from the charts and the feed summary, keeping it in the ledger", async () => {
    const work = await addCategory("Business", { excluded: true });
    await spend("CLIENT DINNER", 100, work);
    const caller = makeCaller();
    const period = { kind: "month", month: "2026-09" } as const;

    const byCategory = await caller.finance.spendByCategory({ period });
    expect(byCategory.map((r) => [r.name, r.spend])).toEqual([["Climbing", 42]]);

    const cashFlow = await caller.finance.cashFlow({ range: "All" });
    expect(cashFlow.months.find((m) => m.monthKey === "2026-09")?.spend).toBe(42);

    expect(await caller.transactions.summary({ period })).toEqual({ count: 2, spent: 42 });

    const { items } = await caller.transactions.list({ period });
    expect(items.map((t) => [t.name, t.excluded, t.excludedByHand])).toEqual(
      expect.arrayContaining([
        ["CLIENT DINNER", true, false],
        ["MOVEMENT CLIMBING GYM", false, false],
      ]),
    );
  });
});
