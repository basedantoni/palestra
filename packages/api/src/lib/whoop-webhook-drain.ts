/**
 * Startup drain for the Whoop webhook event queue.
 *
 * On boot, claims and re-dispatches rows that are stuck in two states:
 * - `status = 'pending'` older than 5s grace window — not yet claimed by the hot path
 * - `status = 'processing'` older than 5 min — orphaned from a crashed machine
 *
 * Uses a single atomic CTE (`FOR UPDATE SKIP LOCKED`) to prevent two machines
 * from claiming the same row on overlapping deploys.
 */

import { eq, sql } from "drizzle-orm";

import { db } from "@src/db";
import { whoopWebhookEvent } from "@src/db/schema/index";
import { trackInFlight } from "./whoop-inflight";
import { dispatchWhoopEvent } from "./whoop-webhook";

const DRAIN_BATCH_LIMIT = 200;
const PENDING_GRACE_MS = 5_000;        // grace window before hot path gives up claim
const ORPHAN_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes — orphaned from crashed machine

export async function drainPendingWhoopEvents(): Promise<{
  scanned: number;
  dispatched: number;
}> {
  const pendingCutoff = new Date(Date.now() - PENDING_GRACE_MS);
  const orphanCutoff = new Date(Date.now() - ORPHAN_THRESHOLD_MS);

  // Single atomic CTE: SELECT FOR UPDATE SKIP LOCKED + UPDATE RETURNING in one round trip
  const claimed = await db.execute<{
    id: string;
    user_id: string;
    event_type: string;
    whoop_resource_id: string | null;
  }>(sql`
    WITH claimed AS (
      SELECT id, user_id, event_type, whoop_resource_id
      FROM whoop_webhook_event
      WHERE (status = 'pending'    AND received_at < ${pendingCutoff})
         OR (status = 'processing' AND received_at < ${orphanCutoff})
      LIMIT ${DRAIN_BATCH_LIMIT}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE whoop_webhook_event
    SET status = 'processing'
    FROM claimed
    WHERE whoop_webhook_event.id = claimed.id
    RETURNING
      whoop_webhook_event.id,
      whoop_webhook_event.user_id,
      whoop_webhook_event.event_type,
      whoop_webhook_event.whoop_resource_id
  `);

  const rows = claimed.rows;
  let dispatched = 0;

  for (const row of rows) {
    const promise = dispatchWhoopEvent({
      eventId: row.id,
      userId: row.user_id,
      eventType: row.event_type,
      resourceId: row.whoop_resource_id,
    });

    if (!promise) {
      await db
        .update(whoopWebhookEvent)
        .set({ status: "skipped", processedAt: new Date() })
        .where(eq(whoopWebhookEvent.id, row.id))
        .catch((err) => console.error("[whoop-drain] Failed to skip event:", err));
      continue;
    }

    trackInFlight(promise);
    dispatched += 1;
  }

  console.log(`[whoop-drain] scanned=${rows.length} dispatched=${dispatched}`);
  return { scanned: rows.length, dispatched };
}
