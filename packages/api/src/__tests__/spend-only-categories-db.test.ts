/**
 * Spend-only categories against a real Postgres (PGlite, KOI-341).
 *
 * - a Plaid sync that moves a known row off expense takes its category off;
 *   one that moves it back re-resolves the category
 * - `retireIncomeAndTransfers` retires the Income and Transfers categories: their
 *   rules become flow rules, their budgets and mappings go, income and
 *   transfer rows lose any category, expense rows in them become
 *   Uncategorized keeping their Manual Category flag. Re-running is a no-op.
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
import { bankCategoryMapping, budget, category, plaidItem, rule, transaction } from "@life-tracker/db/schema/index";
import { env } from "@life-tracker/env/server";
import { asc, eq } from "drizzle-orm";

import { syncPlaidItem } from "../lib/plaid-sync-db";
import { retireIncomeAndTransfers } from "../lib/retire-income-transfers-db";
import { fold } from "../lib/rules";
import { seedFinanceUser, truncateAll } from "./helpers/pglite";

const USER = "user-pglite-spend-only";

beforeEach(async () => {
  await truncateAll(db);
});

/** Sync a modified copy of the seeded transaction under `primary`. */
async function syncAs(primary: string) {
  const [item] = await db.update(plaidItem).set({ plaidEnv: env.PLAID_ENV }).where(eq(plaidItem.userId, USER)).returning();
  mockPlaid.accountsGet.mockResolvedValue({ data: { item: { institution_id: null }, accounts: [] } });
  mockPlaid.transactionsSync.mockResolvedValue({
    data: {
      added: [],
      modified: [
        {
          transaction_id: `txn-${USER}`,
          account_id: `acct-${USER}`,
          amount: 42,
          date: "2026-09-15",
          name: "MOVEMENT CLIMBING GYM",
          pending: false,
          personal_finance_category: { primary, detailed: null },
          iso_currency_code: "USD",
        },
      ],
      removed: [],
      next_cursor: "cursor-1",
      has_more: false,
    },
  });
  await syncPlaidItem(item!.id);
  const [row] = await db.select().from(transaction).where(eq(transaction.userId, USER));
  return row!;
}

describe("Plaid sync of a known transaction the bank reclassifies", () => {
  it("takes the category off when it leaves expense, and re-resolves it on the way back", async () => {
    const { categoryId } = await seedFinanceUser(db, USER);
    await db.insert(bankCategoryMapping).values({ userId: USER, pfcPrimary: "PERSONAL_CARE", categoryId });

    expect(await syncAs("TRANSFER_IN")).toMatchObject({ flow: "transfer", categoryId: null });
    expect(await syncAs("PERSONAL_CARE")).toMatchObject({ flow: "expense", categoryId });
  });

  it("keeps a Manual Category off when it comes back to expense", async () => {
    const { categoryId, transactionId } = await seedFinanceUser(db, USER);
    await db.insert(bankCategoryMapping).values({ userId: USER, pfcPrimary: "PERSONAL_CARE", categoryId });
    await db.update(transaction).set({ categoryOverridden: true }).where(eq(transaction.id, transactionId));

    expect(await syncAs("INCOME")).toMatchObject({ flow: "income", categoryId: null, categoryOverridden: true });
    expect(await syncAs("PERSONAL_CARE")).toMatchObject({ flow: "expense", categoryId: null, categoryOverridden: true });
  });
});

/** A pre-KOI-341 user: Income and Transfers categories with rules, budgets, mappings and rows. */
async function seedLegacyUser() {
  const { transactionId: accountRowId } = await seedFinanceUser(db, USER);
  const [{ accountId }] = (await db
    .select({ accountId: transaction.accountId })
    .from(transaction)
    .where(eq(transaction.id, accountRowId))) as [{ accountId: string }];
  const [income, transfers, food] = [randomUUID(), randomUUID(), randomUUID()];
  await db.insert(category).values([
    { id: income, userId: USER, name: "Income", isSystem: true },
    { id: transfers, userId: USER, name: "Transfers", isSystem: true },
    { id: food, userId: USER, name: "Food & Drink", isSystem: true },
  ]);
  const addRule = (pattern: string, categoryId: string, matchMode: "exact" | "contains" = "contains") =>
    ({ id: randomUUID(), userId: USER, pattern, patternKey: fold(pattern), matchMode, categoryId });
  await db
    .insert(rule)
    .values([addRule("payroll", income), addRule("Robinhood", transfers, "exact"), addRule("starbucks", food)]);
  await db.insert(budget).values(
    [income, transfers, food].map((categoryId) => ({ id: randomUUID(), userId: USER, categoryId, monthKey: "2026-10", limitAmount: 100 })),
  );
  await db.insert(bankCategoryMapping).values([
    { userId: USER, pfcPrimary: "INCOME", categoryId: income },
    { userId: USER, pfcPrimary: "TRANSFER_IN", categoryId: transfers },
    { userId: USER, pfcPrimary: "TRANSFER_OUT", categoryId: transfers },
    { userId: USER, pfcPrimary: "FOOD_AND_DRINK", categoryId: food },
  ]);
  const txn = (name: string, flow: "income" | "expense" | "transfer", categoryId: string, categoryOverridden = false) => ({
    id: randomUUID(),
    userId: USER,
    accountId,
    plaidTransactionId: `plaid-${name}`,
    amount: 10,
    date: new Date("2026-10-01T00:00:00.000Z"),
    name,
    flow,
    categoryId,
    categoryOverridden,
  });
  const rows = {
    payroll: txn("PAYROLL", "income", income),
    handPickedTransfer: txn("VENMO", "transfer", food, true),
    expenseInIncome: txn("REFUND", "expense", income, true),
    expenseInTransfers: txn("ATM", "expense", transfers),
    coffee: txn("STARBUCKS", "expense", food),
  };
  await db.insert(transaction).values(Object.values(rows));
  return { food, rows };
}

async function expectRetired({ food, rows }: Awaited<ReturnType<typeof seedLegacyUser>>) {
  const rules = await db
    .select({ pattern: rule.pattern, matchMode: rule.matchMode, categoryId: rule.categoryId, setFlow: rule.setFlow })
    .from(rule)
    .orderBy(asc(rule.pattern));
  expect(rules).toEqual([
    { pattern: "Robinhood", matchMode: "exact", categoryId: null, setFlow: "transfer" },
    { pattern: "payroll", matchMode: "contains", categoryId: null, setFlow: "income" },
    { pattern: "starbucks", matchMode: "contains", categoryId: food, setFlow: null },
  ]);

  expect(await db.select({ categoryId: budget.categoryId }).from(budget)).toEqual([{ categoryId: food }]);

  const byId = new Map((await db.select().from(transaction)).map((t) => [t.id, t]));
  expect(byId.get(rows.payroll.id)).toMatchObject({ categoryId: null, categoryOverridden: false });
  expect(byId.get(rows.handPickedTransfer.id)).toMatchObject({ categoryId: null, categoryOverridden: true });
  expect(byId.get(rows.expenseInIncome.id)).toMatchObject({ flow: "expense", categoryId: null, categoryOverridden: true });
  expect(byId.get(rows.expenseInTransfers.id)).toMatchObject({ flow: "expense", categoryId: null, categoryOverridden: false });
  expect(byId.get(rows.coffee.id)).toMatchObject({ categoryId: food });

  const names = (await db.select({ name: category.name }).from(category)).map((c) => c.name);
  expect(names.toSorted()).toEqual(["Climbing", "Food & Drink"]);

  const mapping = await db.select({ pfcPrimary: bankCategoryMapping.pfcPrimary, categoryId: bankCategoryMapping.categoryId }).from(bankCategoryMapping);
  expect(new Map(mapping.map((m) => [m.pfcPrimary, m.categoryId]))).toEqual(
    new Map([
      ["INCOME", null],
      ["TRANSFER_IN", null],
      ["TRANSFER_OUT", null],
      ["FOOD_AND_DRINK", food],
    ]),
  );
}

describe("retireIncomeAndTransfers", () => {
  it("retires Income and Transfers: flow rules, no budgets or mappings, no category off expense", async () => {
    const seeded = await seedLegacyUser();

    expect(await retireIncomeAndTransfers(db)).toEqual({ rules: 2, transactions: 2, categories: 2 });

    await expectRetired(seeded);
  });

  it("is idempotent", async () => {
    const seeded = await seedLegacyUser();
    await retireIncomeAndTransfers(db);

    expect(await retireIncomeAndTransfers(db)).toEqual({ rules: 0, transactions: 0, categories: 0 });

    await expectRetired(seeded);
  });
});
