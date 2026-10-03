/** Transaction Period input validation and SQL date bounds, shared by the finance and transactions routers. */
import { gte, lt, type SQL } from "drizzle-orm";
import { z } from "zod";

import { transaction } from "@life-tracker/db/schema/index";
import { MONTH_KEY_REGEX, TRANSACTION_PERIOD_PRESETS } from "@life-tracker/shared";

export const periodSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("month"), month: z.string().regex(MONTH_KEY_REGEX) }),
  z.object({ kind: z.literal("preset"), preset: z.enum(TRANSACTION_PERIOD_PRESETS) }),
  z.object({ kind: z.literal("all") }),
]);

/**
 * WHERE conditions for transaction dates within inclusive calendar-day bounds
 * (from `resolvePeriodBounds`). Plaid dates are stored as UTC midnight of the
 * bank's calendar date, so bounds compare whole UTC days.
 */
export function dateBoundConditions({ from, to }: { from?: string; to?: string }): SQL[] {
  const conds: SQL[] = [];
  if (from) conds.push(gte(transaction.date, new Date(`${from}T00:00:00.000Z`)));
  if (to) {
    const dayAfter = new Date(`${to}T00:00:00.000Z`);
    dayAfter.setUTCDate(dayAfter.getUTCDate() + 1);
    conds.push(lt(transaction.date, dayAfter));
  }
  return conds;
}
