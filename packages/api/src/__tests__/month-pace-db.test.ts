/**
 * finance.monthPace against a real Postgres (PGlite, KOI-344).
 *
 * - cumulative Budgeted Spend skips Excluded rows and split parents (counting
 *   their Splits), and refunds pull it down
 * - Total Budget counts a Subcategory's budget only when its parent has none
 * - last month's cumulative lines up by day of month
 * - with no budgets there's no Pace and no over/under
 * - the current Month stops at today
 */
import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@life-tracker/db", () => import("./helpers/pglite").then((m) => m.pgliteDbModule()));

import { db } from "@life-tracker/db";
import { budget, category, transaction } from "@life-tracker/db/schema/index";
import { eq } from "drizzle-orm";

import { appRouter } from "../routers/index";
import { seedFinanceUser, truncateAll } from "./helpers/pglite";

const USER = "user-pglite-month-pace";

const makeCaller = () => appRouter.createCaller({ session: { user: { id: USER } } } as any);

/** The user's "Climbing" category and its $42 expense on September 15. */
let seeded: Awaited<ReturnType<typeof seedFinanceUser>>;
let accountId: string;

beforeEach(async () => {
  await truncateAll(db);
  seeded = await seedFinanceUser(db, USER);
  const [row] = await db.select({ accountId: transaction.accountId }).from(transaction).where(eq(transaction.id, seeded.transactionId));
  accountId = row!.accountId;
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

async function addBudget(categoryId: string, monthKey: string, limitAmount: number) {
  await db.insert(budget).values({ id: randomUUID(), userId: USER, categoryId, monthKey, limitAmount });
}

describe("finance.monthPace", () => {
  it("tracks Budgeted Spend that counts in totals against Pace to the Total Budget", async () => {
    const gymFees = await addSubcategory("Gym fees");
    await addTransaction("2026-09-03", 10, { categoryId: gymFees });
    await addTransaction("2026-09-05", 100, { excluded: true });
    // A split parent that kept its category: only its Splits count.
    const parent = await addTransaction("2026-09-20", 50);
    await addTransaction("2026-09-20", 30, { parentTransactionId: parent });
    await addTransaction("2026-09-20", 20, { parentTransactionId: parent });
    await addTransaction("2026-09-25", -2);
    await addTransaction("2026-09-26", 500, { categoryId: null });
    await addBudget(seeded.categoryId, "2026-09", 290);
    await addBudget(gymFees, "2026-09", 50);

    const pace = await makeCaller().finance.monthPace({ monthKey: "2026-09" });

    expect(pace.totalBudget).toBe(290);
    expect(pace.days).toHaveLength(30);
    const cumulative = (day: number) => pace.days[day - 1]!.cumulative;
    expect([cumulative(2), cumulative(3), cumulative(15), cumulative(20), cumulative(25), cumulative(30)]).toEqual([
      0, 10, 52, 102, 100, 100,
    ]);
    expect(pace.days[0]!.pace).toBe(0);
    expect(pace.days[29]!.pace).toBe(290);
    expect(pace.overUnder).toBe(-190);
  });

  it("lines up last month's cumulative by day of month", async () => {
    await addTransaction("2026-08-10", 7);
    await addTransaction("2026-08-31", 3);

    const pace = await makeCaller().finance.monthPace({ monthKey: "2026-09" });

    expect(pace.days[8]!.lastMonthCumulative).toBe(0);
    expect(pace.days[9]!.lastMonthCumulative).toBe(7);
    expect(pace.days[29]!.lastMonthCumulative).toBe(7);
  });

  it("has no Pace or over/under without budgets, and stops the current Month at today", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-26T18:00:00.000Z") });
    await addTransaction("2026-10-02", 12);

    const pace = await makeCaller().finance.monthPace({ monthKey: "2026-10" });

    expect(pace.totalBudget).toBeNull();
    expect(pace.overUnder).toBeNull();
    expect(pace.days).toHaveLength(31);
    expect(pace.days.every((d) => d.pace === null)).toBe(true);
    expect(pace.days[25]).toMatchObject({ day: 26, cumulative: 12, lastMonthCumulative: 42 });
    expect(pace.days[26]!.cumulative).toBeNull();
    // September has no 31st.
    expect(pace.days[30]).toMatchObject({ cumulative: null, lastMonthCumulative: null });
  });

  it("is over or under Pace as of today in the current Month", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-26T18:00:00.000Z") });
    await addTransaction("2026-10-02", 400);
    await addBudget(seeded.categoryId, "2026-10", 600);

    const pace = await makeCaller().finance.monthPace({ monthKey: "2026-10" });

    // Pace on day 26 of 31: 600 * 25/30 = 500.
    expect(pace.overUnder).toBe(-100);
  });
});
