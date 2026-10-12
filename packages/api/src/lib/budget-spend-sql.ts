/** Budget Spend query pieces (month key input, transaction columns, month date bounds), shared by the budgets and TCG fund routers. */
import { gte, lt, type SQL } from "drizzle-orm";
import { z } from "zod";

import { transaction } from "@life-tracker/db/schema/index";
import { addMonths, MONTH_KEY_REGEX } from "@life-tracker/shared";

export const monthKeySchema = z.string().regex(MONTH_KEY_REGEX, "monthKey must be YYYY-MM");

export const spendColumns = {
  categoryId: transaction.categoryId,
  amount: transaction.amount,
  flow: transaction.flow,
  excluded: transaction.excluded,
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
