import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@life-tracker/db";
import { financialAccount, plaidItem } from "@life-tracker/db/schema/index";
import { env } from "@life-tracker/env/server";

import { protectedProcedure, router } from "../index";
import { encryptToken } from "../lib/token-encryption";
import { plaidAccountToRow } from "../lib/plaid-account-map";
import {
  PLAID_COUNTRY_CODES,
  PLAID_PRODUCTS,
  getPlaidClient,
  getTokenEncryptionKey,
} from "../lib/plaid-client";

export const plaidRouter = router({
  /** Create a short-lived Plaid Link token for the web client. */
  createLinkToken: protectedProcedure.mutation(async ({ ctx }) => {
    const plaid = getPlaidClient();
    const res = await plaid.linkTokenCreate({
      user: { client_user_id: ctx.session.user.id },
      client_name: "Palestra",
      products: PLAID_PRODUCTS,
      country_codes: PLAID_COUNTRY_CODES,
      language: "en",
      ...(env.PLAID_WEBHOOK_URL ? { webhook: env.PLAID_WEBHOOK_URL } : {}),
    });
    return { linkToken: res.data.link_token };
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

      const accountsRes = await plaid.accountsGet({ access_token: accessToken });
      const institutionName = accountsRes.data.item.institution_id ?? null;

      const plaidItemId = randomUUID();
      await db
        .insert(plaidItem)
        .values({
          id: plaidItemId,
          userId,
          itemId,
          institutionId: accountsRes.data.item.institution_id ?? null,
          institutionName,
          accessTokenEnc: encryptToken(accessToken, getTokenEncryptionKey()),
          status: "active",
        })
        .onConflictDoUpdate({
          target: plaidItem.itemId,
          set: {
            accessTokenEnc: encryptToken(accessToken, getTokenEncryptionKey()),
            status: "active",
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
        const row = plaidAccountToRow(acct, { userId, plaidItemId: resolvedItemId });
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

      return { itemId: resolvedItemId, accountCount: accountsRes.data.accounts.length };
    }),

  /** List the user's connected accounts. */
  listAccounts: protectedProcedure.query(async ({ ctx }) => {
    return db
      .select()
      .from(financialAccount)
      .where(eq(financialAccount.userId, ctx.session.user.id));
  }),
});
