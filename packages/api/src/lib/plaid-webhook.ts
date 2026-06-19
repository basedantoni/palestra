/**
 * Plaid webhook handler — persist-then-drain (KOI-105, Seam 2).
 *
 * Mirrors the Whoop webhook pattern: record the event, kick a sync, return 200
 * fast. The startup drain re-runs any `pending` rows. Idempotent because
 * `syncPlaidItem` is idempotent.
 *
 * NOTE: full Plaid webhook JWT verification (`plaid-verification` header) is a
 * tracked follow-up; for now an event is only acted on when its `item_id`
 * resolves to a known `plaid_item`.
 */
import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { db } from "@life-tracker/db";
import { plaidItem, plaidWebhookEvent } from "@life-tracker/db/schema/index";

import { syncPlaidItem } from "./plaid-sync-db";

const TRANSACTION_CODES = new Set([
  "SYNC_UPDATES_AVAILABLE",
  "INITIAL_UPDATE",
  "HISTORICAL_UPDATE",
  "DEFAULT_UPDATE",
]);

async function processEvent(eventId: string, plaidItemId: string): Promise<void> {
  try {
    await syncPlaidItem(plaidItemId);
    await db
      .update(plaidWebhookEvent)
      .set({ status: "done", processedAt: new Date() })
      .where(eq(plaidWebhookEvent.id, eventId));
  } catch (err) {
    await db
      .update(plaidWebhookEvent)
      .set({
        status: "failed",
        processedAt: new Date(),
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      .where(eq(plaidWebhookEvent.id, eventId));
    console.error("[plaid-webhook] sync failed:", err);
  }
}

export const plaidWebhookApp = new Hono();

plaidWebhookApp.post("/webhook", async (c) => {
  const body = await c.req.json().catch(() => null);
  const itemId = body?.item_id as string | undefined;
  const webhookType = (body?.webhook_type as string | undefined) ?? "";
  const webhookCode = (body?.webhook_code as string | undefined) ?? "";
  if (!itemId) return c.json({ error: "missing item_id" }, 400);

  const [item] = await db
    .select({ id: plaidItem.id })
    .from(plaidItem)
    .where(eq(plaidItem.itemId, itemId))
    .limit(1);
  // Unknown item: ack so Plaid stops retrying, but do nothing.
  if (!item) return c.json({ ok: true });

  const eventId = randomUUID();
  await db.insert(plaidWebhookEvent).values({
    id: eventId,
    itemId,
    webhookType,
    webhookCode,
    status: "pending",
  });

  if (webhookType === "ITEM") {
    // Surface connection health for the reconnect banner.
    const status =
      webhookCode === "LOGIN_REPAIRED" ? "active" : webhookCode.toLowerCase();
    await db.update(plaidItem).set({ status }).where(eq(plaidItem.id, item.id));
    await db
      .update(plaidWebhookEvent)
      .set({ status: "done", processedAt: new Date() })
      .where(eq(plaidWebhookEvent.id, eventId));
    return c.json({ ok: true });
  }

  if (webhookType === "TRANSACTIONS" && TRANSACTION_CODES.has(webhookCode)) {
    void processEvent(eventId, item.id);
  } else {
    await db
      .update(plaidWebhookEvent)
      .set({ status: "done", processedAt: new Date() })
      .where(eq(plaidWebhookEvent.id, eventId));
  }

  return c.json({ ok: true });
});

/** Re-run any pending Plaid webhook events (startup recovery). */
export async function drainPendingPlaidEvents(): Promise<void> {
  const pending = await db
    .select({ id: plaidWebhookEvent.id, itemId: plaidWebhookEvent.itemId })
    .from(plaidWebhookEvent)
    .where(eq(plaidWebhookEvent.status, "pending"));

  for (const ev of pending) {
    const [item] = await db
      .select({ id: plaidItem.id })
      .from(plaidItem)
      .where(eq(plaidItem.itemId, ev.itemId))
      .limit(1);
    if (!item) {
      await db
        .update(plaidWebhookEvent)
        .set({ status: "failed", errorMessage: "item not found", processedAt: new Date() })
        .where(eq(plaidWebhookEvent.id, ev.id));
      continue;
    }
    await processEvent(ev.id, item.id);
  }
}
