/** Budget Spend query pieces (month key input, transaction columns, month date bounds, category tree, monthly history), shared by the budgets, finance and TCG fund routers. */
import { TRPCError } from "@trpc/server";
import { and, eq, gte, inArray, lt, lte, or, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import { budget, category, transaction } from "@life-tracker/db/schema/index";
import { addMonths, MONTH_KEY_REGEX } from "@life-tracker/shared";

import { categoryMonthly } from "./budget-spend";
import { skippedInTotals } from "./counts-in-totals-sql";

export const monthKeySchema = z.string().regex(MONTH_KEY_REGEX, "monthKey must be YYYY-MM");

export const spendColumns = {
  categoryId: transaction.categoryId,
  amount: transaction.amount,
  flow: transaction.flow,
  excluded: skippedInTotals,
  date: transaction.date,
};

/**
 * Date conditions covering whole calendar months `fromMonth`..`toMonth`.
 * Plaid dates are stored as UTC midnight of the bank's date, so the range is
 * [first day 00:00Z, first day of the following month 00:00Z).
 */
export function monthRange(fromMonth: string, toMonth: string): SQL[] {
  return [
    gte(transaction.date, new Date(`${fromMonth}-01T00:00:00.000Z`)),
    lt(transaction.date, new Date(`${addMonths(toMonth, 1)}-01T00:00:00.000Z`)),
  ];
}

/** The user's category and its Subcategories' ids: what its rolled-up Budgeted Spend covers. */
export async function categoryTreeIds(userId: string, categoryId: string): Promise<string[]> {
  const rows = await db
    .select({ id: category.id })
    .from(category)
    .where(and(eq(category.userId, userId), or(eq(category.id, categoryId), eq(category.parentId, categoryId))));
  return rows.map((r) => r.id);
}

/**
 * The user's category's Budgeted Spend (a parent's including its
 * Subcategories') and limit for each of the `months` months ending at
 * `monthKey`. NOT_FOUND unless the category is the user's.
 */
export async function loadCategoryMonthly(userId: string, categoryId: string, monthKey: string, months: number) {
  const categoryIds = await categoryTreeIds(userId, categoryId);
  if (!categoryIds.includes(categoryId)) throw new TRPCError({ code: "NOT_FOUND", message: "Category not found" });
  const first = addMonths(monthKey, 1 - months);
  const [limits, txns] = await Promise.all([
    db
      .select({ monthKey: budget.monthKey, limitAmount: budget.limitAmount })
      .from(budget)
      .where(
        and(
          eq(budget.userId, userId),
          eq(budget.categoryId, categoryId),
          gte(budget.monthKey, first),
          lte(budget.monthKey, monthKey),
        ),
      ),
    db
      .select(spendColumns)
      .from(transaction)
      .where(
        and(eq(transaction.userId, userId), inArray(transaction.categoryId, categoryIds), ...monthRange(first, monthKey)),
      ),
  ]);
  return categoryMonthly(txns, categoryIds, limits, monthKey, months);
}
