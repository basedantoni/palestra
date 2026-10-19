/** Budget Spend query pieces (month key input, transaction columns, month date bounds, category tree), shared by the budgets and TCG fund routers. */
import { and, eq, gte, lt, or, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import { category, transaction } from "@life-tracker/db/schema/index";
import { addMonths, MONTH_KEY_REGEX } from "@life-tracker/shared";

import { isExcluded } from "./counts-in-totals-sql";

export const monthKeySchema = z.string().regex(MONTH_KEY_REGEX, "monthKey must be YYYY-MM");

export const spendColumns = {
  categoryId: transaction.categoryId,
  amount: transaction.amount,
  flow: transaction.flow,
  excluded: isExcluded,
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
