/**
 * Dev login + finance fixtures (KOI-302). Dev only: refuses NODE_ENV=production.
 *
 * Creates the dev user (via Better-Auth, so the password hash is real), marks
 * onboarding done, and resets a "Fixture Bank" Plaid item with accounts and
 * transactions covering the awkward cases: repeated merchants, blank Manual
 * Category rows, pending rows, a transfer pair, and an unknown Plaid category.
 *
 * Idempotent: every run deletes the fixture item (cascading to its accounts and
 * transactions) and the dev user's category rules, then re-inserts the same
 * rows with the same ids. Dates are relative to today, inside the current month.
 *
 * Run: pnpm db:seed:finance
 */
import { db } from "@life-tracker/db";
import {
  category,
  categoryRule,
  financialAccount,
  plaidItem,
  transaction,
  user,
  userPreferences,
} from "@life-tracker/db/schema/index";
import { env } from "@life-tracker/env/server";
import { eq } from "drizzle-orm";

import { auth } from "../packages/auth/src/index";
import { SEED_CATEGORIES, categoryNameForPfc } from "../packages/api/src/lib/category-seed";
import { classifyFlow } from "../packages/api/src/lib/transaction-flow";
import { deterministicUUID } from "../packages/db/src/seed";

const DEV_EMAIL = "dev@palestra.local";
const DEV_PASSWORD = "palestra-dev-password";

const FIXTURE_ITEM_ID = "fixture-item-dev";
const id = (key: string) => deterministicUUID(`koi-302-fixture:${key}`);

type Fixture = {
  key: string;
  account: "checking" | "savings" | "credit";
  /** Plaid sign: positive = money out. */
  amount: number;
  daysAgo: number;
  name: string;
  merchantName?: string;
  pfc: string | null;
  pending?: boolean;
  /** Manual Category with no category picked (categoryOverridden, categoryId null). */
  blankManual?: boolean;
  transferPair?: string;
};

const FIXTURES: Fixture[] = [
  // Repeated merchant: same description several times (rule preview / "categorize like this").
  { key: "coffee-1", account: "credit", amount: 5.75, daysAgo: 0, name: "BLUE BOTTLE COFFEE #12", merchantName: "Blue Bottle Coffee", pfc: "FOOD_AND_DRINK" },
  { key: "coffee-2", account: "credit", amount: 6.25, daysAgo: 2, name: "BLUE BOTTLE COFFEE #12", merchantName: "Blue Bottle Coffee", pfc: "FOOD_AND_DRINK" },
  { key: "coffee-3", account: "credit", amount: 4.5, daysAgo: 4, name: "BLUE BOTTLE COFFEE #12", merchantName: "Blue Bottle Coffee", pfc: "FOOD_AND_DRINK" },
  { key: "coffee-4", account: "checking", amount: 5.75, daysAgo: 6, name: "BLUE BOTTLE COFFEE #12", merchantName: "Blue Bottle Coffee", pfc: "FOOD_AND_DRINK" },
  // Same merchant, but blank Manual Category: a rule must still fill these (KOI-300).
  { key: "coffee-blank", account: "credit", amount: 7.0, daysAgo: 1, name: "BLUE BOTTLE COFFEE #12", merchantName: "Blue Bottle Coffee", pfc: "FOOD_AND_DRINK", blankManual: true },
  { key: "amazon-blank", account: "credit", amount: 42.99, daysAgo: 3, name: "AMZN Mktp US*2K4", merchantName: "Amazon", pfc: "GENERAL_MERCHANDISE", blankManual: true },
  // Pending.
  { key: "uber-pending", account: "credit", amount: 18.4, daysAgo: 0, name: "UBER *TRIP", merchantName: "Uber", pfc: "TRANSPORTATION", pending: true },
  { key: "grocery-pending", account: "checking", amount: 63.12, daysAgo: 0, name: "WHOLEFDS AUS 10234", merchantName: "Whole Foods", pfc: "FOOD_AND_DRINK", pending: true },
  // Transfer pair: checking → savings, linked by transferPairId.
  { key: "transfer-out", account: "checking", amount: 500, daysAgo: 5, name: "ONLINE TRANSFER TO SAV ...4821", pfc: "TRANSFER_OUT", transferPair: "transfer-1" },
  { key: "transfer-in", account: "savings", amount: -500, daysAgo: 4, name: "ONLINE TRANSFER FROM CHK ...1094", pfc: "TRANSFER_IN", transferPair: "transfer-1" },
  // Unknown Plaid category (not one of the 16 PFC primaries) → Uncategorized, expense.
  { key: "unknown-pfc", account: "checking", amount: 12.0, daysAgo: 2, name: "SQ *MYSTERY VENDOR", pfc: "SOME_NEW_PFC_PRIMARY" },
  { key: "null-pfc", account: "checking", amount: 3.0, daysAgo: 3, name: "POS DEBIT 8812", pfc: null },
  // Ordinary rows so the feed and budgets look normal.
  { key: "paycheck", account: "checking", amount: -2400, daysAgo: 7, name: "ACME CORP PAYROLL", pfc: "INCOME" },
  { key: "rent", account: "checking", amount: 1650, daysAgo: 8, name: "ZELLE TO LANDLORD", pfc: "RENT_AND_UTILITIES" },
  { key: "netflix", account: "credit", amount: 15.49, daysAgo: 9, name: "NETFLIX.COM", merchantName: "Netflix", pfc: "ENTERTAINMENT" },
];

const ACCOUNTS = [
  { key: "checking", name: "Fixture Checking", mask: "1094", type: "depository", subtype: "checking", balance: 3210.55 },
  { key: "savings", name: "Fixture Savings", mask: "4821", type: "depository", subtype: "savings", balance: 12500 },
  { key: "credit", name: "Fixture Credit Card", mask: "7777", type: "credit", subtype: "credit card", balance: 412.33 },
] as const;

/** UTC midnight `daysAgo` days back, clamped to the 1st so every row lands in the current month. */
function fixtureDate(daysAgo: number): Date {
  const now = new Date();
  const day = Math.max(1, now.getUTCDate() - daysAgo);
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day));
}

async function ensureDevUser(): Promise<string> {
  const existing = await db.query.user.findFirst({ where: eq(user.email, DEV_EMAIL) });
  if (existing) return existing.id;
  const res = await auth.api.signUpEmail({
    body: { email: DEV_EMAIL, password: DEV_PASSWORD, name: "Dev User" },
  });
  return res.user.id;
}

async function seedFinance() {
  if (env.NODE_ENV === "production") {
    throw new Error("seed-finance is dev only; refusing to run with NODE_ENV=production");
  }

  const userId = await ensureDevUser();

  await db.transaction(async (tx) => {
    await tx
      .insert(userPreferences)
      .values({
        userId,
        weightUnit: "lbs",
        distanceUnit: "mi",
        muscleGroupSystem: "bodybuilding",
        onboardingCompleted: true,
      })
      .onConflictDoUpdate({ target: userPreferences.userId, set: { onboardingCompleted: true } });

    await tx
      .insert(category)
      .values(SEED_CATEGORIES.map((name) => ({ id: id(`category:${name}`), userId, name, isSystem: true })))
      .onConflictDoNothing();
    const categories = await tx.query.category.findMany({ where: eq(category.userId, userId) });
    const categoryIdByName = new Map(categories.map((c) => [c.name, c.id]));

    // Reset: cascades to the fixture accounts and their transactions.
    await tx.delete(plaidItem).where(eq(plaidItem.itemId, FIXTURE_ITEM_ID));
    await tx.delete(categoryRule).where(eq(categoryRule.userId, userId));

    const plaidItemId = id("item");
    await tx.insert(plaidItem).values({
      id: plaidItemId,
      userId,
      itemId: FIXTURE_ITEM_ID,
      institutionName: "Fixture Bank",
      // Not a real token: "Sync now" on this item fails by design.
      accessTokenEnc: "fixture-not-a-real-token",
    });

    await tx.insert(financialAccount).values(
      ACCOUNTS.map((a) => ({
        id: id(`account:${a.key}`),
        userId,
        plaidItemId,
        plaidAccountId: `fixture-account-${a.key}`,
        name: a.name,
        mask: a.mask,
        type: a.type,
        subtype: a.subtype,
        currentBalance: a.balance,
        availableBalance: a.balance,
        isoCurrencyCode: "USD",
      })),
    );

    await tx.insert(transaction).values(
      FIXTURES.map((f) => ({
        id: id(`transaction:${f.key}`),
        userId,
        accountId: id(`account:${f.account}`),
        plaidTransactionId: `fixture-${f.key}`,
        amount: f.amount,
        date: fixtureDate(f.daysAgo),
        name: f.name,
        merchantName: f.merchantName ?? null,
        pending: f.pending ?? false,
        flow: classifyFlow(f.pfc),
        plaidCategoryPrimary: f.pfc,
        categoryId: f.blankManual ? null : (categoryIdByName.get(categoryNameForPfc(f.pfc)) ?? null),
        categoryOverridden: f.blankManual ?? false,
        transferPairId: f.transferPair ? id(`pair:${f.transferPair}`) : null,
        isoCurrencyCode: "USD",
      })),
    );
  });

  console.log(`Dev user: ${DEV_EMAIL} / ${DEV_PASSWORD}`);
  console.log(`Seeded ${ACCOUNTS.length} accounts, ${FIXTURES.length} transactions (Fixture Bank)`);
}

seedFinance()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
