import { randomUUID } from "node:crypto";

import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import {
  balanceSnapshot,
  financialAccount,
  savingsGoal,
  savingsGoalAccount,
} from "@life-tracker/db/schema/index";

import { protectedProcedure, router } from "../index";
import { type BalancePoint, projectGoal } from "../lib/goal-projection";

/** Sum each account's daily snapshot into one balance series for the goal. */
function snapshotsToSeries(
  rows: Array<{ asOfDate: string; balance: number }>,
): BalancePoint[] {
  const byDate = new Map<string, number>();
  for (const r of rows) byDate.set(r.asOfDate, (byDate.get(r.asOfDate) ?? 0) + r.balance);
  return [...byDate.entries()]
    .map(([asOfDate, balance]) => ({ asOfDate, balance }))
    .sort((a, b) => a.asOfDate.localeCompare(b.asOfDate));
}

export const goalsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const goals = await db
      .select()
      .from(savingsGoal)
      .where(eq(savingsGoal.userId, userId));

    const result = [];
    for (const goal of goals) {
      const links = await db
        .select({ accountId: savingsGoalAccount.accountId })
        .from(savingsGoalAccount)
        .where(eq(savingsGoalAccount.goalId, goal.id));
      const accountIds = links.map((l) => l.accountId);

      let series: BalancePoint[] = [];
      if (accountIds.length > 0) {
        const snaps = await db
          .select({ asOfDate: balanceSnapshot.asOfDate, balance: balanceSnapshot.balance })
          .from(balanceSnapshot)
          .where(inArray(balanceSnapshot.accountId, accountIds));
        series = snapshotsToSeries(snaps);
      }

      const projection = projectGoal({
        snapshots: series,
        target: goal.targetAmount,
        targetDate: goal.targetDate ?? undefined,
      });

      result.push({
        id: goal.id,
        name: goal.name,
        targetAmount: goal.targetAmount,
        targetDate: goal.targetDate,
        accountIds,
        ...projection,
      });
    }
    return result;
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(80),
        targetAmount: z.number().positive(),
        targetDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        accountIds: z.array(z.string().uuid()).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Only allow linking accounts the user owns.
      const owned = await db
        .select({ id: financialAccount.id })
        .from(financialAccount)
        .where(
          and(
            eq(financialAccount.userId, userId),
            inArray(financialAccount.id, input.accountIds),
          ),
        );
      const ownedIds = owned.map((o) => o.id);
      if (ownedIds.length === 0) throw new Error("No owned accounts to link");

      const goalId = randomUUID();
      await db.insert(savingsGoal).values({
        id: goalId,
        userId,
        name: input.name,
        targetAmount: input.targetAmount,
        targetDate: input.targetDate ?? null,
      });
      await db
        .insert(savingsGoalAccount)
        .values(ownedIds.map((accountId) => ({ goalId, accountId })));
      return { id: goalId };
    }),

  remove: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await db
        .delete(savingsGoal)
        .where(and(eq(savingsGoal.id, input.id), eq(savingsGoal.userId, ctx.session.user.id)));
      return { ok: true };
    }),
});
