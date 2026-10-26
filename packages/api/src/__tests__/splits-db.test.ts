/**
 * Splits against a real Postgres (PGlite, KOI-343, ADR 0007).
 *
 * - `countsInTotals` skips a split parent and counts its Splits
 * - transactions.split writes the Splits (replacing any), nulls the parent's
 *   category and marks it reviewed; an unbalanced or ineligible split is refused
 * - list nests Splits under their parent, and a category filter finds a parent
 *   through its Splits; summary, budgets and the finance charts count each Split once
 * - transactions.unsplit deletes the Splits and re-resolves the parent's category
 * - rule preview and apply, Bank Category remapping and reset to automatic skip
 *   split parents and Splits
 * - Plaid sync: a removed parent takes its Splits with it; a changed amount
 *   undoes the split, re-resolves the parent's category and sends it back to
 *   Unreviewed, as does a flow off expense; a new date moves the Splits with it
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
import { bankCategoryMapping, category, plaidItem, rule, transaction } from "@life-tracker/db/schema/index";
import { env } from "@life-tracker/env/server";
import { asc, eq, isNotNull } from "drizzle-orm";

import { countsInTotals } from "../lib/counts-in-totals-sql";
import { syncPlaidItem } from "../lib/plaid-sync-db";
import { fold } from "../lib/rules";
import { appRouter } from "../routers/index";
import { seedFinanceUser, truncateAll } from "./helpers/pglite";

const USER = "user-pglite-splits";

const makeCaller = () => appRouter.createCaller({ session: { user: { id: USER } } } as any);
const SEPTEMBER = { kind: "month", month: "2026-09" } as const;

/** The user's "Climbing" category and its one posted $42 September expense. */
let seeded: Awaited<ReturnType<typeof seedFinanceUser>>;

beforeEach(async () => {
  await truncateAll(db);
  seeded = await seedFinanceUser(db, USER);
});

async function seededAccountId(): Promise<string> {
  const [row] = await db.select({ accountId: transaction.accountId }).from(transaction).where(eq(transaction.id, seeded.transactionId));
  return row!.accountId;
}

/** A Split of the seeded transaction, written directly. */
async function addSplitRow(name: string, amount: number) {
  await db.insert(transaction).values({
    id: randomUUID(),
    userId: USER,
    accountId: await seededAccountId(),
    parentTransactionId: seeded.transactionId,
    amount,
    date: new Date("2026-09-15T00:00:00.000Z"),
    name,
    flow: "expense",
    categoryOverridden: true,
    reviewed: true,
  });
}

describe("countsInTotals", () => {
  it("skips a split parent and counts its Splits, alongside excluded rows", async () => {
    await addSplitRow("PIECE A", 30);
    await addSplitRow("PIECE B", 12);
    await db.insert(transaction).values({
      id: randomUUID(),
      userId: USER,
      accountId: await seededAccountId(),
      plaidTransactionId: "txn-by-hand",
      amount: 5,
      date: new Date("2026-09-16T00:00:00.000Z"),
      name: "BY HAND",
      flow: "expense",
      excluded: true,
    });

    const rows = await db.select({ name: transaction.name, counts: countsInTotals }).from(transaction);

    expect(Object.fromEntries(rows.map((r) => [r.name, r.counts]))).toEqual({
      "MOVEMENT CLIMBING GYM": false,
      "PIECE A": true,
      "PIECE B": true,
      "BY HAND": false,
    });
  });
});

async function addCategory(name: string) {
  const id = randomUUID();
  await db.insert(category).values({ id, userId: USER, name });
  return id;
}

async function splitsOf(parentId: string) {
  return db
    .select({ amount: transaction.amount, categoryId: transaction.categoryId, note: transaction.note })
    .from(transaction)
    .where(eq(transaction.parentTransactionId, parentId))
    .orderBy(asc(transaction.amount));
}

async function row(id: string) {
  const [r] = await db.select().from(transaction).where(eq(transaction.id, id));
  return r!;
}

/** Split the seeded $42 into $30 Climbing ("shoes") and $12 Uncategorized. */
async function splitSeeded() {
  await makeCaller().transactions.split({
    id: seeded.transactionId,
    pieces: [
      { amount: 30, categoryId: seeded.categoryId, note: "shoes" },
      { amount: 12, categoryId: null },
    ],
  });
}

describe("transactions.split", () => {
  it("writes Splits sharing the parent's user, account, date and flow; the parent keeps its amount, loses its category", async () => {
    await db
      .update(transaction)
      .set({ plaidCategoryPrimary: "ENTERTAINMENT", reviewed: false })
      .where(eq(transaction.id, seeded.transactionId));

    await splitSeeded();

    const splits = await db.select().from(transaction).where(isNotNull(transaction.parentTransactionId));
    const parent = await row(seeded.transactionId);
    expect(splits.map((s) => [s.amount, s.categoryId, s.note]).toSorted()).toEqual([
      [12, null, null],
      [30, seeded.categoryId, "shoes"],
    ]);
    for (const s of splits) {
      expect(s).toMatchObject({
        userId: USER,
        accountId: parent.accountId,
        date: parent.date,
        flow: "expense",
        pending: false,
        categoryOverridden: true,
        plaidTransactionId: null,
        plaidCategoryPrimary: null,
        plaidCategoryDetailed: null,
      });
    }
    expect(parent).toMatchObject({ amount: 42, plaidCategoryPrimary: "ENTERTAINMENT", categoryId: null, reviewed: true });
  });

  it("carries a hand exclusion to the Splits", async () => {
    await db.update(transaction).set({ excluded: true }).where(eq(transaction.id, seeded.transactionId));
    await splitSeeded();
    const splits = await db.select({ excluded: transaction.excluded }).from(transaction).where(isNotNull(transaction.parentTransactionId));
    expect(splits).toEqual([{ excluded: true }, { excluded: true }]);
  });

  it("replaces existing Splits", async () => {
    await splitSeeded();
    await makeCaller().transactions.split({
      id: seeded.transactionId,
      pieces: [
        { amount: 14, categoryId: null },
        { amount: 14, categoryId: null },
        { amount: 14, categoryId: seeded.categoryId },
      ],
    });
    expect((await splitsOf(seeded.transactionId)).map((s) => s.amount)).toEqual([14, 14, 14]);
  });

  it("refuses pieces that don't balance, an ineligible parent, a Split, and another user's category", async () => {
    const caller = makeCaller();
    await expect(
      caller.transactions.split({ id: seeded.transactionId, pieces: [{ amount: 30, categoryId: null }, { amount: 11.99, categoryId: null }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await db.update(transaction).set({ pending: true }).where(eq(transaction.id, seeded.transactionId));
    await expect(
      caller.transactions.split({ id: seeded.transactionId, pieces: [{ amount: 30, categoryId: null }, { amount: 12, categoryId: null }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Pending transactions can't be split until they post" });
    await db.update(transaction).set({ pending: false }).where(eq(transaction.id, seeded.transactionId));

    await splitSeeded();
    const [piece] = await db.select({ id: transaction.id }).from(transaction).where(isNotNull(transaction.parentTransactionId));
    await expect(
      caller.transactions.split({ id: piece!.id, pieces: [{ amount: 6, categoryId: null }, { amount: 6, categoryId: null }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "A split piece can't be split again" });

    await expect(
      caller.transactions.split({ id: seeded.transactionId, pieces: [{ amount: 30, categoryId: randomUUID() }, { amount: 12, categoryId: null }] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("list and totals", () => {
  it("nests Splits under their parent and finds the parent through a Split's category", async () => {
    await splitSeeded();
    const caller = makeCaller();

    const all = await caller.transactions.list({ period: SEPTEMBER });
    expect(all.items).toHaveLength(1);
    expect(all.items[0]!.id).toBe(seeded.transactionId);
    expect(all.items[0]!.splits.map((s) => [s.amount, s.categoryName, s.note])).toEqual([
      [30, "Climbing", "shoes"],
      [12, null, null],
    ]);

    for (const categoryId of [seeded.categoryId, null]) {
      const { items } = await caller.transactions.list({ period: SEPTEMBER, categoryId });
      expect(items.map((t) => t.id)).toEqual([seeded.transactionId]);
    }
    const other = await addCategory("Groceries");
    expect((await caller.transactions.list({ period: SEPTEMBER, categoryId: other })).items).toEqual([]);
  });

  it("counts each Split once and never the parent: summary, budgets and the finance charts", async () => {
    await splitSeeded();
    const caller = makeCaller();

    expect(await caller.transactions.summary({ period: SEPTEMBER })).toEqual({ count: 1, spent: 42 });
    expect(await caller.transactions.summary({ period: SEPTEMBER, categoryId: seeded.categoryId })).toEqual({ count: 1, spent: 30 });
    expect(await caller.transactions.summary({ period: SEPTEMBER, categoryId: null })).toEqual({ count: 1, spent: 12 });

    const byCategory = await caller.finance.spendByCategory({ period: SEPTEMBER });
    expect(byCategory.map((r) => [r.categoryId, r.total])).toEqual([
      [seeded.categoryId, 30],
      [null, 12],
    ]);
    const cashFlow = await caller.finance.cashFlow({ range: "All" });
    expect(cashFlow.months.find((m) => m.monthKey === "2026-09")?.spend).toBe(42);
    const budgets = await caller.budgets.forMonth({ monthKey: "2026-09" });
    expect(budgets.categories.find((c) => c.categoryId === seeded.categoryId)?.spent).toBe(30);
  });
});

describe("transactions.unsplit", () => {
  it("deletes the Splits and returns the parent to its automatic category", async () => {
    await db.insert(rule).values({
      id: randomUUID(),
      userId: USER,
      pattern: "CLIMBING",
      patternKey: fold("CLIMBING"),
      matchMode: "contains",
      categoryId: seeded.categoryId,
    });
    await db.update(transaction).set({ categoryOverridden: true }).where(eq(transaction.id, seeded.transactionId));
    await splitSeeded();

    await makeCaller().transactions.unsplit({ id: seeded.transactionId });

    expect(await splitsOf(seeded.transactionId)).toEqual([]);
    expect(await row(seeded.transactionId)).toMatchObject({ categoryId: seeded.categoryId, categoryOverridden: false });
  });

  it("refuses a transaction with no Splits", async () => {
    await expect(makeCaller().transactions.unsplit({ id: seeded.transactionId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("automatic categorization skips split parents and Splits", () => {
  beforeEach(async () => {
    await db.update(transaction).set({ plaidCategoryPrimary: "ENTERTAINMENT" }).where(eq(transaction.id, seeded.transactionId));
    await splitSeeded();
  });

  it("rule preview and apply touch neither", async () => {
    const caller = makeCaller();
    const other = await addCategory("Gym");
    for (const ruleInput of [
      { pattern: "CLIMBING", matchMode: "contains", categoryId: other, setFlow: null },
      { pattern: "MOVEMENT", matchMode: "contains", categoryId: null, setFlow: "income" },
    ] as const) {
      expect(await caller.rules.preview(ruleInput)).toEqual({ matchCount: 0 });
      expect((await caller.rules.create({ ...ruleInput, applyToExisting: true })).applied).toBe(0);
    }
    expect(await row(seeded.transactionId)).toMatchObject({ categoryId: null, flow: "expense" });
    expect((await splitsOf(seeded.transactionId)).map((s) => s.categoryId)).toEqual([null, seeded.categoryId]);
  });

  it("a Bank Category remap leaves the parent without a category", async () => {
    const other = await addCategory("Fun");
    await db.update(transaction).set({ categoryOverridden: false }).where(eq(transaction.id, seeded.transactionId));

    expect(await makeCaller().bankCategories.setMapping({ bankCategory: "ENTERTAINMENT", categoryId: other })).toEqual({ applied: 0 });
    expect((await row(seeded.transactionId)).categoryId).toBeNull();
  });

  it("reset to automatic and a flow change are refused on the parent and its Splits", async () => {
    const caller = makeCaller();
    const [piece] = await db.select({ id: transaction.id }).from(transaction).where(isNotNull(transaction.parentTransactionId));
    for (const id of [seeded.transactionId, piece!.id]) {
      await expect(caller.transactions.resetCategory({ id })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(caller.transactions.setFlow({ id, flow: "income" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    await caller.transactions.setCategory({ id: seeded.transactionId, categoryId: seeded.categoryId });
    expect((await row(seeded.transactionId)).categoryId).toBeNull();
  });
});

/** Sync a delta for the seeded transaction: `modified` with these fields, or `removed`. */
async function syncSeeded(change: { removed: true } | { amount: number; name?: string; primary?: string; date?: string }) {
  const [item] = await db.update(plaidItem).set({ plaidEnv: env.PLAID_ENV }).where(eq(plaidItem.userId, USER)).returning();
  mockPlaid.accountsGet.mockResolvedValue({ data: { item: { institution_id: null }, accounts: [] } });
  const id = `txn-${USER}`;
  mockPlaid.transactionsSync.mockResolvedValue({
    data: {
      added: [],
      modified:
        "removed" in change
          ? []
          : [
              {
                transaction_id: id,
                account_id: `acct-${USER}`,
                amount: change.amount,
                date: change.date ?? "2026-09-15",
                name: change.name ?? "MOVEMENT CLIMBING GYM",
                pending: false,
                personal_finance_category: { primary: change.primary ?? "ENTERTAINMENT", detailed: null },
                iso_currency_code: "USD",
              },
            ],
      removed: "removed" in change ? [{ transaction_id: id }] : [],
      next_cursor: "cursor-1",
      has_more: false,
    },
  });
  await syncPlaidItem(item!.id);
}

describe("Plaid sync of a split transaction", () => {
  beforeEach(async () => {
    await db.update(transaction).set({ plaidCategoryPrimary: "ENTERTAINMENT" }).where(eq(transaction.id, seeded.transactionId));
    await splitSeeded();
  });

  it("deletes a removed parent and, by cascade, its Splits", async () => {
    await syncSeeded({ removed: true });
    expect(await db.select().from(transaction)).toEqual([]);
  });

  it("undoes the split when the amount changes: parent re-resolved and Unreviewed", async () => {
    const fun = await addCategory("Fun");
    await db.insert(bankCategoryMapping).values({ userId: USER, pfcPrimary: "ENTERTAINMENT", categoryId: fun });

    await syncSeeded({ amount: 45 });

    expect(await splitsOf(seeded.transactionId)).toEqual([]);
    expect(await row(seeded.transactionId)).toMatchObject({ amount: 45, categoryId: fun, categoryOverridden: false, reviewed: false });
  });

  it("re-resolves a hand-set expense as an expense when it unsplits, whatever the bank now calls it", async () => {
    const fun = await addCategory("Fun");
    await db.insert(bankCategoryMapping).values({ userId: USER, pfcPrimary: "INCOME", categoryId: fun });
    await db.update(transaction).set({ flowOverridden: true }).where(eq(transaction.id, seeded.transactionId));

    await syncSeeded({ amount: 45, primary: "INCOME" });

    expect(await row(seeded.transactionId)).toMatchObject({ flow: "expense", categoryId: fun, reviewed: false });
  });

  it("undoes the split when the bank moves the parent off expense", async () => {
    await syncSeeded({ amount: 42, primary: "TRANSFER_OUT" });

    expect(await splitsOf(seeded.transactionId)).toEqual([]);
    expect(await row(seeded.transactionId)).toMatchObject({ flow: "transfer", categoryId: null, reviewed: false });
  });

  it("keeps the split when the amount holds to the cent, moving the Splits to a new date", async () => {
    await syncSeeded({ amount: 42.001, name: "MOVEMENT CLIMBING GYM #2", date: "2026-09-16" });

    const splits = await db.select({ date: transaction.date }).from(transaction).where(isNotNull(transaction.parentTransactionId));
    expect(splits.map((s) => s.date.toISOString())).toEqual(["2026-09-16T00:00:00.000Z", "2026-09-16T00:00:00.000Z"]);
    expect(await row(seeded.transactionId)).toMatchObject({ name: "MOVEMENT CLIMBING GYM #2", categoryId: null, reviewed: true });
  });
});
