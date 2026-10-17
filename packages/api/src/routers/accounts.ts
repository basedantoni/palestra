import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import { balanceSnapshot, financialAccount } from "@life-tracker/db/schema/index";

import { protectedProcedure, router } from "../index";
import { todayUtc } from "../lib/date-utils";
import { accountBalanceHistory, TIMEFRAMES, timeframeStart } from "../lib/net-worth";

export const accountsRouter = router({
  /**
   * One account's daily balance over a chip's window ending today (the UTC
   * Balance Snapshot day, ADR 0003), plus `change` from the window's first
   * point. NOT_FOUND unless the caller owns the account.
   */
  balanceHistory: protectedProcedure
    .input(z.object({ accountId: z.string(), timeframe: z.enum(TIMEFRAMES) }))
    .query(async ({ ctx, input }) => {
      const [account] = await db
        .select({ id: financialAccount.id, type: financialAccount.type })
        .from(financialAccount)
        .where(and(eq(financialAccount.id, input.accountId), eq(financialAccount.userId, ctx.session.user.id)));
      if (!account) throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });

      const snapshots = await db
        .select({
          accountId: balanceSnapshot.accountId,
          asOfDate: balanceSnapshot.asOfDate,
          balance: balanceSnapshot.balance,
        })
        .from(balanceSnapshot)
        .where(eq(balanceSnapshot.accountId, account.id));
      const today = todayUtc();
      return accountBalanceHistory(account, snapshots, { from: timeframeStart(input.timeframe, today), to: today });
    }),
});
