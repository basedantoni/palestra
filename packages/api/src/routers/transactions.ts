import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, isNull, lt, not, notInArray, or, sql, type SQL } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { db } from "@life-tracker/db";
import { category, financialAccount, transaction } from "@life-tracker/db/schema/index";

import { resolvePeriodBounds, todayInTimeZone } from "@life-tracker/shared";

import { protectedProcedure, router } from "../index";
import { countsInTotals, hasSplits, isExcluded } from "../lib/counts-in-totals-sql";
import { dateBoundConditions, periodSchema } from "../lib/transaction-period-sql";
import { NO_CATEGORY_FLOWS, categoryOnFlowChange, resolveCategory, resolveFlow } from "../lib/rules";
import { type Conn, loadBankCategoryMapping, loadMatchableRules, ownedCategory } from "../lib/rules-db";
import { validateSplit } from "../lib/splits";
import { TRANSACTION_FLOWS, type TransactionFlow, classifyFlow } from "../lib/transaction-flow";
import { getUserTimezone } from "../lib/user-timezone";

const filtersSchema = z.object({
  period: periodSchema.default({ kind: "all" }),
  accountIds: z.array(z.string().uuid()).max(50).default([]),
  /** A category, or null for Uncategorized; omitted = every category. */
  categoryId: z.string().uuid().nullable().optional(),
  /** false = the Unreviewed queue; omitted = both. */
  reviewed: z.boolean().optional(),
});

/** Rows that can carry a Category: expense, or no flow yet. Income and transfer carry none (KOI-341). */
const takesCategory = or(isNull(transaction.flow), notInArray(transaction.flow, [...NO_CATEGORY_FLOWS]))!;

/** WHERE conditions for the caller's filtered transactions; "today" (for shortcut periods) is the user's local date. */
async function filterConditions(userId: string, filters: z.infer<typeof filtersSchema>): Promise<SQL[]> {
  const today = todayInTimeZone(new Date(), await getUserTimezone(userId));
  const conds: SQL[] = [eq(transaction.userId, userId), ...dateBoundConditions(resolvePeriodBounds(filters.period, today))];
  if (filters.accountIds.length > 0) conds.push(inArray(transaction.accountId, filters.accountIds));
  // Uncategorized is spend with no category, not every row without one: a split parent carries none (ADR 0007).
  if (filters.categoryId === null) conds.push(isNull(transaction.categoryId), takesCategory, not(hasSplits));
  else if (filters.categoryId) conds.push(eq(transaction.categoryId, filters.categoryId));
  if (filters.reviewed !== undefined) conds.push(eq(transaction.reviewed, filters.reviewed));
  return conds;
}

/** A row's top-level transaction: a Split's parent, else itself. */
const topLevelId = sql<string>`coalesce(${transaction.parentTransactionId}, ${transaction.id})`;

/**
 * Top-level transactions with a row (itself or a Split) matching `conds`, so a
 * category filter finds a parent through its Splits. Inside the subquery
 * "transaction" names its own table, as in `countsInTotals`.
 */
const listedFor = (conds: SQL[]) =>
  and(
    isNull(transaction.parentTransactionId),
    sql`${transaction.id} in (select coalesce(parent_transaction_id, id) from "transaction" where ${and(...conds)})`,
  )!;

const listColumns = {
  id: transaction.id,
  date: transaction.date,
  name: transaction.name,
  merchantName: transaction.merchantName,
  amount: transaction.amount,
  flow: transaction.flow,
  flowOverridden: transaction.flowOverridden,
  pending: transaction.pending,
  // Excluded by hand or through its category; `excludedByHand` is the toggle's own flag.
  excluded: isExcluded,
  excludedByHand: transaction.excluded,
  note: transaction.note,
  reviewed: transaction.reviewed,
  transferPairId: transaction.transferPairId,
  parentTransactionId: transaction.parentTransactionId,
  categoryId: transaction.categoryId,
  categoryOverridden: transaction.categoryOverridden,
  categoryName: category.name,
  accountId: transaction.accountId,
  accountName: financialAccount.name,
  isoCurrencyCode: transaction.isoCurrencyCode,
};

/** A row's automatic category, as a fresh sync resolves it: matching rule, else Default Category; none off expense. */
async function loadAutomaticCategory(
  conn: Conn,
  userId: string,
  row: { name: string; plaidCategoryPrimary: string | null; flow: TransactionFlow | null },
): Promise<string | null> {
  return resolveCategory(
    row.name,
    row.plaidCategoryPrimary,
    await loadMatchableRules(conn, userId),
    await loadBankCategoryMapping(conn, userId),
    row.flow,
  );
}

/** Splits and split parents keep their categories by hand: no automatic category, no flow change (ADR 0007). */
function assertNotSplit(row: { parentTransactionId: string | null; hasSplits: boolean }, message: string): void {
  if (row.parentTransactionId || row.hasSplits) throw new TRPCError({ code: "BAD_REQUEST", message });
}

const unreviewedOf = (userId: string) => and(eq(transaction.userId, userId), eq(transaction.reviewed, false));

/** "<ISO date>|<uuid>" — the last row of the previous page. */
const cursorSchema = z.string().transform((value, ctx) => {
  const [iso, id] = value.split("|");
  const date = new Date(iso ?? "");
  if (!id || Number.isNaN(date.getTime()) || !z.string().uuid().safeParse(id).success) {
    ctx.addIssue({ code: "custom", message: "Invalid cursor" });
    return z.NEVER;
  }
  return { date, id };
});

export const transactionsRouter = router({
  /** Paginated transaction feed with optional period / account / category filters. */
  list: protectedProcedure
    .input(
      filtersSchema.extend({
        limit: z.number().int().min(1).max(200).default(50),
        /** Opaque keyset cursor from the previous page's `nextCursor`. */
        cursor: cursorSchema.nullish(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const conds = [listedFor(await filterConditions(userId, input))];
      if (input.cursor) {
        // Keyset on (date, id) desc: stable while syncs insert newer rows.
        conds.push(
          or(
            lt(transaction.date, input.cursor.date),
            and(eq(transaction.date, input.cursor.date), lt(transaction.id, input.cursor.id)),
          )!,
        );
      }

      const rows = await db
        .select(listColumns)
        .from(transaction)
        .leftJoin(category, eq(category.id, transaction.categoryId))
        .innerJoin(financialAccount, eq(financialAccount.id, transaction.accountId))
        .where(and(...conds))
        .orderBy(desc(transaction.date), desc(transaction.id))
        .limit(input.limit + 1); // one extra row tells us whether a next page exists

      const page = rows.slice(0, input.limit);
      const last = page.at(-1);
      const nextCursor =
        rows.length > input.limit && last ? `${last.date.toISOString()}|${last.id}` : null;

      const splits =
        page.length === 0
          ? []
          : await db
              .select(listColumns)
              .from(transaction)
              .leftJoin(category, eq(category.id, transaction.categoryId))
              .innerJoin(financialAccount, eq(financialAccount.id, transaction.accountId))
              .where(and(eq(transaction.userId, userId), inArray(transaction.parentTransactionId, page.map((t) => t.id))))
              .orderBy(desc(transaction.amount), transaction.id);
      const splitsByParent = Map.groupBy(splits, (s) => s.parentTransactionId);
      const items = page.map((t) => ({ ...t, splits: splitsByParent.get(t.id) ?? [] }));
      return { items, nextCursor };
    }),

  /**
   * Totals for the filtered feed: how many transactions it lists (a split one
   * once), and expense spend (flow = expense and counting in totals — the same
   * rule budgets use, so a split one's Splits that match).
   */
  summary: protectedProcedure.input(filtersSchema).query(async ({ ctx, input }) => {
    const conds = await filterConditions(ctx.session.user.id, input);
    const [row] = await db
      .select({
        count: sql<number>`count(distinct ${topLevelId})::int`,
        spent: sql<number | null>`sum(${transaction.amount}) filter (where ${transaction.flow} = 'expense' and ${countsInTotals})`,
      })
      .from(transaction)
      .where(and(...conds));
    return { count: row?.count ?? 0, spent: Number(row?.spent ?? 0) };
  }),

  /**
   * Pick a category by hand; it becomes a Manual Category, even when null (ADR 0004).
   * Income and transfer rows carry no category (KOI-341), nor does a split parent
   * (ADR 0007), so they are left alone.
   */
  setCategory: protectedProcedure
    .input(z.object({ id: z.string().uuid(), categoryId: z.string().uuid().nullable() }))
    .mutation(async ({ ctx, input }) => {
      await db
        .update(transaction)
        .set({ categoryId: input.categoryId, categoryOverridden: true, reviewed: true })
        .where(
          and(
            eq(transaction.id, input.id),
            eq(transaction.userId, ctx.session.user.id),
            takesCategory,
            not(hasSplits),
          ),
        );
      return { ok: true };
    }),

  /**
   * Reset to automatic: clear the Manual Category and re-resolve as a fresh sync
   * would (matching rule, else Default Category). Splits and split parents have
   * no automatic category (ADR 0007): unsplit instead.
   */
  resetCategory: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const owned = and(eq(transaction.id, input.id), eq(transaction.userId, userId));
      const [row] = await db
        .select({
          name: transaction.name,
          plaidCategoryPrimary: transaction.plaidCategoryPrimary,
          flow: transaction.flow,
          parentTransactionId: transaction.parentTransactionId,
          hasSplits,
        })
        .from(transaction)
        .where(owned)
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Transaction not found" });
      assertNotSplit(row, "A split transaction's categories stay as set; unsplit it instead");

      const categoryId = await loadAutomaticCategory(db, userId, row);
      await db.update(transaction).set({ categoryId, categoryOverridden: false }).where(owned);
      return { ok: true };
    }),

  /**
   * Correct a transaction's flow; null resets to automatic (ADR 0001), as a
   * fresh sync resolves it: the bank's flow, then a matching flow Rule. The
   * override flag makes the Plaid sync upsert leave `flow` alone. The category
   * follows the flow (`categoryOnFlowChange`, KOI-341).
   */
  setFlow: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        flow: z.enum(TRANSACTION_FLOWS).nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const owned = and(eq(transaction.id, input.id), eq(transaction.userId, userId));
      await db.transaction(async (tx) => {
        // Locked so a concurrent sync/match can't change pending or the pair between read and write.
        const [row] = await tx
          .select({
            pending: transaction.pending,
            name: transaction.name,
            plaidCategoryPrimary: transaction.plaidCategoryPrimary,
            transferPairId: transaction.transferPairId,
            flow: transaction.flow,
            categoryId: transaction.categoryId,
            categoryOverridden: transaction.categoryOverridden,
            parentTransactionId: transaction.parentTransactionId,
            hasSplits,
          })
          .from(transaction)
          .where(owned)
          .limit(1)
          .for("update");
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Transaction not found" });
        // Splits share their parent's expense flow (ADR 0007).
        assertNotSplit(row, "A split transaction stays an expense; unsplit it first");
        // Posting issues a new Plaid id, so an override on a pending row would be lost.
        if (row.pending) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Pending transactions can't be changed until they post",
          });
        }

        const rules = await loadMatchableRules(tx, userId);
        const flow =
          input.flow ??
          resolveFlow(classifyFlow(row.plaidCategoryPrimary), row.name, rules, {
            flowOverridden: false,
            transferPairId: row.transferPairId,
          });
        const mapping = await loadBankCategoryMapping(tx, userId);
        const automaticCategoryId = resolveCategory(row.name, row.plaidCategoryPrimary, rules, mapping, flow);
        await tx
          .update(transaction)
          .set({ flow, flowOverridden: input.flow !== null, categoryId: categoryOnFlowChange(row, flow, automaticCategoryId), reviewed: true })
          .where(owned);
        // A leg that is no longer a transfer breaks the Transfer Pair; the other leg stays an unpaired transfer.
        const { transferPairId } = row;
        if (transferPairId && flow !== "transfer") {
          await tx
            .update(transaction)
            .set({ transferPairId: null })
            .where(
              and(
                eq(transaction.transferPairId, transferPairId),
                eq(transaction.userId, userId),
              ),
            );
        }
      });
      return { ok: true };
    }),

  /**
   * Split a posted expense outside a Transfer Pair into Splits (ADR 0007),
   * replacing any it has. Each is a Manual Category, even Uncategorized; the
   * parent keeps its amount and Bank Category, carries no category, and counts
   * as reviewed.
   */
  split: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        pieces: z
          .array(
            z.object({
              amount: z.number().finite(),
              categoryId: z.string().uuid().nullable(),
              note: z.string().max(500).nullish(),
            }),
          )
          .max(50),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const owned = and(eq(transaction.id, input.id), eq(transaction.userId, userId));
      await db.transaction(async (tx) => {
        // Locked so a concurrent sync can't change the amount between the check and the write.
        const [parent] = await tx
          .select({
            amount: transaction.amount,
            pending: transaction.pending,
            flow: transaction.flow,
            transferPairId: transaction.transferPairId,
            parentTransactionId: transaction.parentTransactionId,
            excluded: transaction.excluded,
            accountId: transaction.accountId,
            date: transaction.date,
            name: transaction.name,
            merchantName: transaction.merchantName,
            isoCurrencyCode: transaction.isoCurrencyCode,
          })
          .from(transaction)
          .where(owned)
          .limit(1)
          .for("update");
        if (!parent) throw new TRPCError({ code: "NOT_FOUND", message: "Transaction not found" });
        const valid = validateSplit(parent, input.pieces);
        if (!valid.ok) throw new TRPCError({ code: "BAD_REQUEST", message: valid.reason });
        for (const categoryId of new Set(input.pieces.flatMap((p) => (p.categoryId ? [p.categoryId] : [])))) {
          await ownedCategory(tx, userId, categoryId);
        }

        await tx
          .delete(transaction)
          .where(and(eq(transaction.userId, userId), eq(transaction.parentTransactionId, input.id)));
        await tx.insert(transaction).values(
          input.pieces.map((piece) => ({
            id: randomUUID(),
            userId,
            accountId: parent.accountId,
            parentTransactionId: input.id,
            amount: piece.amount,
            date: parent.date,
            name: parent.name,
            merchantName: parent.merchantName,
            flow: "expense" as const,
            categoryId: piece.categoryId,
            categoryOverridden: true,
            note: piece.note ?? null,
            // A hand exclusion carries to the Splits: they count in its place.
            excluded: parent.excluded,
            reviewed: true,
            isoCurrencyCode: parent.isoCurrencyCode,
          })),
        );
        await tx.update(transaction).set({ categoryId: null, reviewed: true }).where(owned);
      });
      return { ok: true };
    }),

  /** Undo a split: delete the Splits and return the parent to its automatic category, as `resetCategory` resolves it. */
  unsplit: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const owned = and(eq(transaction.id, input.id), eq(transaction.userId, userId));
      await db.transaction(async (tx) => {
        const [row] = await tx
          .select({ name: transaction.name, plaidCategoryPrimary: transaction.plaidCategoryPrimary, flow: transaction.flow })
          .from(transaction)
          .where(and(owned, hasSplits))
          .limit(1)
          .for("update");
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Split transaction not found" });

        const categoryId = await loadAutomaticCategory(tx, userId, row);
        await tx
          .delete(transaction)
          .where(and(eq(transaction.userId, userId), eq(transaction.parentTransactionId, input.id)));
        await tx.update(transaction).set({ categoryId, categoryOverridden: false }).where(owned);
      });
      return { ok: true };
    }),

  /** Exclude or include one transaction by hand; one in an Excluded Category stays Excluded either way. */
  setExcluded: protectedProcedure
    .input(z.object({ id: z.string().uuid(), excluded: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await db
        .update(transaction)
        .set({ excluded: input.excluded, reviewed: true })
        .where(and(eq(transaction.id, input.id), eq(transaction.userId, ctx.session.user.id)));
      return { ok: true };
    }),

  /** Clear Unreviewed on the given transactions (a row, or both legs of a Transfer Pair). */
  markReviewed: protectedProcedure
    .input(z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      await db
        .update(transaction)
        .set({ reviewed: true })
        .where(and(eq(transaction.userId, ctx.session.user.id), inArray(transaction.id, input.ids)));
      return { ok: true };
    }),

  markAllReviewed: protectedProcedure.mutation(async ({ ctx }) => {
    await db.update(transaction).set({ reviewed: true }).where(unreviewedOf(ctx.session.user.id));
    return { ok: true };
  }),

  /** How many of the caller's transactions are Unreviewed (the "N to review" badge). */
  unreviewedCount: protectedProcedure.query(async ({ ctx }) => {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(transaction)
      .where(unreviewedOf(ctx.session.user.id));
    return row?.count ?? 0;
  }),

  setNote: protectedProcedure
    .input(z.object({ id: z.string().uuid(), note: z.string().max(500).nullable() }))
    .mutation(async ({ ctx, input }) => {
      await db
        .update(transaction)
        .set({ note: input.note, reviewed: true })
        .where(and(eq(transaction.id, input.id), eq(transaction.userId, ctx.session.user.id)));
      return { ok: true };
    }),
});
