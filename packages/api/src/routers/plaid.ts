import { randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import { financialAccount, plaidItem } from "@life-tracker/db/schema/index";
import { env } from "@life-tracker/env/server";

import { protectedProcedure, router } from "../index";
import { encryptToken } from "../lib/token-encryption";
import { plaidAccountToRow } from "../lib/plaid-account-map";
import { canRepairInUpdateMode, getOwnedPlaidItem } from "../lib/plaid-item-access";
import { removeFinancialAccount, removePlaidItem } from "../lib/plaid-account-remove";
import { foreignPlaidEnvError, isForeignPlaidEnv } from "../lib/plaid-env";
import { syncPlaidItem } from "../lib/plaid-sync-db";
import { syncPlaidItemsForUser } from "../lib/plaid-sync-now";
import {
  PLAID_COUNTRY_CODES,
  PLAID_PRODUCTS,
  describePlaidError,
  getPlaidClient,
  getTokenEncryptionKey,
} from "../lib/plaid-client";

/**
 * Display name for a Plaid institution (the institution_id is not one). Best
 * effort: a failed lookup only costs the label, never the link.
 */
async function lookupInstitutionName(
  plaid: ReturnType<typeof getPlaidClient>,
  institutionId: string,
): Promise<string | null> {
  try {
    const res = await plaid.institutionsGetById({
      institution_id: institutionId,
      country_codes: PLAID_COUNTRY_CODES,
    });
    return res.data.institution.name;
  } catch (err) {
    console.error(`[plaid] institutionsGetById failed for ${institutionId}:`, describePlaidError(err));
    return null;
  }
}

export const plaidRouter = router({
  /**
   * Create a short-lived Plaid Link token for the web client. With
   * `plaidItemId`, the token opens Link in update mode to repair that existing
   * connection (re-auth) instead of linking a new bank.
   */
  createLinkToken: protectedProcedure
    .input(z.object({ plaidItemId: z.string().uuid().optional() }).optional())
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      let accessToken: string | null = null;
      if (input?.plaidItemId) {
        const item = await getOwnedPlaidItem(userId, input.plaidItemId);
        if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Plaid item not found" });
        const foreignEnv = foreignPlaidEnvError(item.plaidEnv);
        if (foreignEnv) throw new TRPCError({ code: "PRECONDITION_FAILED", message: foreignEnv });
        if (item.status === "revoked") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Access was revoked at the bank — remove it and connect the bank again",
          });
        }
        accessToken = item.accessToken;
      }

      const plaid = getPlaidClient();
      try {
        const res = await plaid.linkTokenCreate({
          user: { client_user_id: userId },
          client_name: "Palestra",
          // Update mode re-auths the item's existing products; passing products errors.
          ...(accessToken ? { access_token: accessToken } : { products: PLAID_PRODUCTS }),
          country_codes: PLAID_COUNTRY_CODES,
          language: "en",
          ...(env.PLAID_WEBHOOK_URL ? { webhook: env.PLAID_WEBHOOK_URL } : {}),
        });
        return { linkToken: res.data.link_token };
      } catch (err) {
        console.error(
          "[plaid] linkTokenCreate failed:",
          (err as { response?: { data?: unknown } })?.response?.data ?? err,
        );
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: describePlaidError(err) });
      }
    }),

  /**
   * Exchange a Link `public_token` for an access token, persist the Plaid Item
   * (token encrypted at rest), and upsert its accounts.
   */
  exchangePublicToken: protectedProcedure
    .input(z.object({ publicToken: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const plaid = getPlaidClient();

      const exchange = await plaid.itemPublicTokenExchange({
        public_token: input.publicToken,
      });
      const accessToken = exchange.data.access_token;
      const itemId = exchange.data.item_id;

      const accountsRes = await plaid.accountsGet({
        access_token: accessToken,
      });

      const institutionId = accountsRes.data.item.institution_id ?? null;
      const institutionName = institutionId
        ? await lookupInstitutionName(plaid, institutionId)
        : null;

      const plaidItemId = randomUUID();
      await db
        .insert(plaidItem)
        .values({
          id: plaidItemId,
          userId,
          itemId,
          institutionId,
          institutionName,
          accessTokenEnc: encryptToken(accessToken, getTokenEncryptionKey()),
          status: "active",
          plaidEnv: env.PLAID_ENV,
        })
        .onConflictDoUpdate({
          target: plaidItem.itemId,
          set: {
            accessTokenEnc: encryptToken(accessToken, getTokenEncryptionKey()),
            status: "active",
            plaidEnv: env.PLAID_ENV,
            ...(institutionName ? { institutionName } : {}),
          },
        });

      // Resolve the (possibly pre-existing) item row id for FK wiring.
      const [itemRow] = await db
        .select({ id: plaidItem.id })
        .from(plaidItem)
        .where(eq(plaidItem.itemId, itemId))
        .limit(1);
      const resolvedItemId = itemRow?.id ?? plaidItemId;

      for (const acct of accountsRes.data.accounts) {
        const row = plaidAccountToRow(acct, {
          userId,
          plaidItemId: resolvedItemId,
        });
        await db
          .insert(financialAccount)
          .values({ id: randomUUID(), ...row })
          .onConflictDoUpdate({
            target: financialAccount.plaidAccountId,
            set: {
              name: row.name,
              officialName: row.officialName,
              mask: row.mask,
              type: row.type,
              subtype: row.subtype,
              currentBalance: row.currentBalance,
              availableBalance: row.availableBalance,
              isoCurrencyCode: row.isoCurrencyCode,
            },
          });
      }

      // Don't wait on Plaid's webhook (may be unset/unreachable in dev). Fire-
      // and-forget: right after link Plaid can answer PRODUCT_NOT_READY, in which
      // case the INITIAL_UPDATE webhook or a manual syncNow picks it up.
      syncPlaidItem(resolvedItemId).catch((err) =>
        console.error(
          `[plaid] initial sync failed for plaid_item ${resolvedItemId}:`,
          describePlaidError(err),
        ),
      );

      return {
        itemId: resolvedItemId,
        accountCount: accountsRes.data.accounts.length,
      };
    }),

  /** List the user's connected accounts. */
  listAccounts: protectedProcedure.query(async ({ ctx }) => {
    return db
      .select()
      .from(financialAccount)
      .where(eq(financialAccount.userId, ctx.session.user.id));
  }),

  /**
   * Remove a connected account (and its transactions). Revokes the Plaid Item
   * when it was the institution's last account.
   */
  removeAccount: protectedProcedure
    .input(z.object({ accountId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await removeFinancialAccount(ctx.session.user.id, input.accountId);
      if (!result.removed) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
      }
      return { itemRemoved: result.itemRemoved };
    }),

  /**
   * Remove a whole bank (Plaid Item), e.g. one left with no accounts after a
   * failed revoke. Without `force`, a failed revoke keeps the row and returns
   * the error; `force` (user confirmed) deletes it anyway — the Item may then
   * still exist at Plaid and must be removed in the Plaid dashboard.
   */
  removeItem: protectedProcedure
    .input(z.object({ plaidItemId: z.string().uuid(), force: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      const result = await removePlaidItem(ctx.session.user.id, input.plaidItemId, input.force);
      if (!result.removed && result.notFound) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Plaid item not found" });
      }
      return result.removed
        ? { removed: true as const, revoked: result.revoked }
        : { removed: false as const, error: result.error };
    }),

  /**
   * Called after Plaid Link update mode succeeds for a broken item. Update mode
   * returns no public token to exchange, so prove the repair by syncing: only a
   * successful sync marks the item active. Awaited so the client refreshes
   * after the catch-up data has landed.
   */
  markItemRepaired: protectedProcedure
    .input(z.object({ plaidItemId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [item] = await db
        .select({ id: plaidItem.id, status: plaidItem.status })
        .from(plaidItem)
        .where(and(eq(plaidItem.id, input.plaidItemId), eq(plaidItem.userId, ctx.session.user.id)))
        .limit(1);
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Plaid item not found" });
      if (!canRepairInUpdateMode(item.status)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Item can't be repaired from status "${item.status}"`,
        });
      }

      let counts;
      try {
        counts = await syncPlaidItem(item.id);
      } catch (err) {
        const message = describePlaidError(err);
        console.error(`[plaid] post-repair sync failed for plaid_item ${item.id}:`, message);
        throw new TRPCError({ code: "BAD_GATEWAY", message });
      }
      await db.update(plaidItem).set({ status: "active" }).where(eq(plaidItem.id, item.id));
      return counts;
    }),

  /** Sync the caller's Plaid items now instead of waiting on a webhook. */
  syncNow: protectedProcedure
    .input(z.object({ plaidItemId: z.string().uuid().optional() }))
    .mutation(async ({ ctx, input }) => {
      const results = await syncPlaidItemsForUser(ctx.session.user.id, input.plaidItemId);
      if (!results) throw new TRPCError({ code: "NOT_FOUND", message: "Plaid item not found" });
      return results;
    }),

  /**
   * List linked institutions + their connection health (for the reconnect
   * banner). `foreignEnv` flags items linked under another PLAID_ENV, which
   * this server can't sync or revoke.
   */
  listItems: protectedProcedure.query(async ({ ctx }) => {
    const items = await db
      .select({
        id: plaidItem.id,
        institutionId: plaidItem.institutionId,
        institutionName: plaidItem.institutionName,
        status: plaidItem.status,
        plaidEnv: plaidItem.plaidEnv,
      })
      .from(plaidItem)
      .where(eq(plaidItem.userId, ctx.session.user.id));
    return items.map((item) => ({ ...item, foreignEnv: isForeignPlaidEnv(item.plaidEnv) }));
  }),
});
