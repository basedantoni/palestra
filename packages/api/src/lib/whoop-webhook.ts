/**
 * Whoop webhook handler — Phase 3 (real workout-import processor)
 *
 * POST /webhook (mounted at /api/whoop/webhook by the server)
 *
 * 1. Buffers the raw request body (required for HMAC — must use raw bytes,
 *    not re-serialized JSON).
 * 2. Parses the body to extract the Whoop user ID.
 * 3. Looks up the whoop_connection by whoopUserId to get the encrypted
 *    webhook secret.
 * 4. If no connection found → 401.
 * 5. Verifies HMAC-SHA256 of the raw body against the X-Whoop-Signature
 *    header (format: "sha256=<hex>"). Returns 401 on mismatch without
 *    writing anything.
 * 6. On success: inserts a whoop_webhook_event row (event ID is PK —
 *    onConflictDoNothing makes re-deliveries idempotent), updates
 *    webhookLastReceivedAt, returns 200.
 * 7. After returning 200: routes to the correct processor via setImmediate
 *    based on eventType (workout.updated, workout.deleted, sleep.*, recovery.*, etc.)
 */

import {
  createHmac,
  timingSafeEqual as cryptoTimingSafeEqual,
} from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";

import { trackInFlight } from "./whoop-inflight";

import { db } from "@life-tracker/db";
import {
  notification,
  whoopConnection,
  whoopRecovery,
  whoopSleep,
  whoopWebhookEvent,
  workout,
} from "@life-tracker/db/schema/index";
import { env } from "@life-tracker/env/server";
import { whoopSportToWorkoutType } from "@life-tracker/shared";
import { WORKOUT_TYPE_LABELS } from "./workout-utils";

import {
  whoopActivityToExerciseLog,
  type WhoopActivityDetail,
} from "./whoop-activity-dto";
import { upsertWhoopWorkout } from "./whoop-upsert";
import { getValidWhoopAccessToken, WHOOP_API_BASE } from "./whoop-client";
import { recalculateProgressiveOverload } from "./progressive-overload-db";
import { recalculateMuscleGroupVolumeForWeek } from "./muscle-group-volume-db";

export const whoopWebhookApp = new Hono();
const WHOOP_REPLAY_WINDOW_MS = 5 * 60 * 1000;

// Whoop v2 webhook payload shape
interface WhoopWebhookPayload {
  user_id?: number | string;
  id?: string; // UUID of the resource (workout, sleep, or for recovery: sleep UUID)
  type?: string; // "workout.updated" | "workout.deleted" | "sleep.updated" | etc.
  trace_id?: string; // unique per delivery — used as dedup key
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return cryptoTimingSafeEqual(bufA, bufB);
}

function parseWhoopTimestampMs(timestampHeader: string): number | null {
  const numeric = Number(timestampHeader);
  if (!Number.isFinite(numeric)) return null;
  return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function markEventProcessed(eventId: string): Promise<void> {
  await db
    .update(whoopWebhookEvent)
    .set({ status: "processed", processedAt: new Date() })
    .where(eq(whoopWebhookEvent.id, eventId));
}

async function markEventSkipped(eventId: string): Promise<void> {
  await db
    .update(whoopWebhookEvent)
    .set({ status: "skipped", processedAt: new Date() })
    .where(eq(whoopWebhookEvent.id, eventId));
}

async function markEventFailed(
  eventId: string,
  errorMessage: string,
): Promise<void> {
  await db
    .update(whoopWebhookEvent)
    .set({ status: "failed", processedAt: new Date(), errorMessage })
    .where(eq(whoopWebhookEvent.id, eventId));
}

/**
 * Fires fire-and-forget recalculations for the given workout date.
 * Call after any workout create/update/delete.
 */
function fireRecalculations(userId: string, workoutDate: Date): void {
  // recalculateMuscleGroupVolumeForWeek normalizes to the ISO week internally.
  recalculateMuscleGroupVolumeForWeek(userId, workoutDate).catch((err) =>
    console.error("[whoop-webhook] Muscle group volume recalc failed:", err),
  );

  recalculateProgressiveOverload(userId, []).catch((err) =>
    console.error("[whoop-webhook] Progressive overload recalc failed:", err),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// workoutProcessor — handles workout.updated events
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Processes a workout.updated webhook event.
 *
 * Flow:
 * 1. Skip if autoImportEnabled = false → mark skipped
 * 2. Fetch full activity from Whoop
 * 3. Skip if score_state = "PENDING_SCORE" → mark skipped
 * 4. Three-path dedup based on whether a workout already exists for (userId, whoopActivityId)
 *    - Manual link (source != "whoop"): update exercise log metrics only
 *    - Auto-imported (source = "whoop"): update workout + exercise log
 *    - New import: create workout + exercise log
 * 5. Wrap DB writes in transaction; update lastImportedAt inside transaction
 * 6. Fire-and-forget recalculations
 * 7. Mark event processed; on error mark failed
 */
export async function workoutProcessor(
  eventId: string,
  userId: string,
  whoopActivityId: string,
): Promise<void> {
  try {
    // 1. Check autoImportEnabled and notifyOnAutoImport
    const [connection] = await db
      .select({
        autoImportEnabled: whoopConnection.autoImportEnabled,
        notifyOnAutoImport: whoopConnection.notifyOnAutoImport,
      })
      .from(whoopConnection)
      .where(eq(whoopConnection.userId, userId))
      .limit(1);

    if (!connection?.autoImportEnabled) {
      console.log(
        `[whoop-webhook] Auto-import disabled for user ${userId}, skipping event ${eventId}`,
      );
      await markEventSkipped(eventId);
      return;
    }

    const shouldNotify = connection.notifyOnAutoImport;

    // 2. Fetch full activity from Whoop
    const accessToken = await getValidWhoopAccessToken(userId);
    const response = await fetch(
      `${WHOOP_API_BASE}/activity/workout/${whoopActivityId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Whoop API error ${response.status}: ${text}`);
    }

    const activity = (await response.json()) as WhoopActivityDetail;

    // 3. Skip PENDING_SCORE — real data not available yet
    if (activity.score_state === "PENDING_SCORE") {
      console.log(
        `[whoop-webhook] PENDING_SCORE for activity ${whoopActivityId}, skipping event ${eventId}`,
      );
      await markEventSkipped(eventId);
      return;
    }

    // 4. Three-path dedup + import (shared with backfill) — see whoop-upsert.ts
    const result = await upsertWhoopWorkout(userId, activity);

    const workoutDate = new Date(activity.start);

    // 5b. Emit notification for auto-update & new-import (not manual-link, not delete)
    if (result.path !== "manual-link" && shouldNotify) {
      const workoutType = whoopSportToWorkoutType(
        activity.sport_id,
        activity.sport_name,
      );
      const patch = whoopActivityToExerciseLog(activity);
      const typeLabel = WORKOUT_TYPE_LABELS[workoutType] ?? workoutType;
      const durationMin =
        patch.durationMinutes ??
        Math.round(
          (new Date(activity.end).getTime() -
            new Date(activity.start).getTime()) /
            60_000,
        );
      const message = `${typeLabel} · ${durationMin} min`;

      await db.insert(notification).values({
        id: crypto.randomUUID(),
        userId,
        type: "whoop_workout_imported",
        title: "Whoop workout imported",
        message,
        payload: { workoutId: result.workoutId },
      });
    }

    // 6. Fire-and-forget recalculations
    fireRecalculations(userId, workoutDate);

    // 7. Mark event processed
    await markEventProcessed(eventId);
    console.log(
      `[whoop-webhook] Processed workout.updated event ${eventId} for activity ${whoopActivityId}`,
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[whoop-webhook] Failed to process event ${eventId}:`, err);
    await markEventFailed(eventId, errorMessage).catch(() => {
      // Best-effort — don't let markEventFailed errors surface
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// workoutDeleteProcessor — handles workout.deleted events
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Processes a workout.deleted webhook event.
 *
 * Looks up the workout by (userId, whoopActivityId).
 * If found: deletes it (cascade deletes exercise logs) and fires recalculations.
 * If not found: no-op (idempotent).
 * Always marks event processed.
 */
export async function workoutDeleteProcessor(
  eventId: string,
  userId: string,
  whoopActivityId: string,
): Promise<void> {
  try {
    const [existingWorkout] = await db
      .select({ id: workout.id, date: workout.date })
      .from(workout)
      .where(
        and(
          eq(workout.userId, userId),
          eq(workout.whoopActivityId, whoopActivityId),
        ),
      )
      .limit(1);

    if (existingWorkout) {
      await db.delete(workout).where(eq(workout.id, existingWorkout.id));

      // Fire-and-forget recalculations
      fireRecalculations(userId, existingWorkout.date);

      console.log(
        `[whoop-webhook] Deleted workout ${existingWorkout.id} for activity ${whoopActivityId}`,
      );
    } else {
      console.log(
        `[whoop-webhook] workout.deleted: no workout found for activity ${whoopActivityId} — marking processed (idempotent)`,
      );
    }

    await markEventProcessed(eventId);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(
      `[whoop-webhook] Failed to process delete event ${eventId}:`,
      err,
    );
    await markEventFailed(eventId, errorMessage).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// sleepProcessor — handles sleep.created and sleep.updated events
// ─────────────────────────────────────────────────────────────────────────────

interface WhoopSleepDetail {
  id: string;
  nap: boolean;
  score_state?: string;
  score?: {
    sleep_performance_percentage?: number;
    sleep_consistency_percentage?: number;
    sleep_efficiency_percentage?: number;
    respiratory_rate?: number;
    stage_summary?: {
      total_in_bed_time_milli?: number;
      total_awake_time_milli?: number;
      total_light_sleep_time_milli?: number;
      total_slow_wave_sleep_time_milli?: number;
      total_rem_sleep_time_milli?: number;
      total_no_data_time_milli?: number;
      disturbance_count?: number;
    };
  } | null;
  start: string;
  end: string;
}

/**
 * Processes sleep.created and sleep.updated webhook events.
 *
 * Flow:
 * 1. Skip if autoImportEnabled = false → mark skipped
 * 2. Fetch sleep record from Whoop's sleep endpoint
 * 3. Upsert by (userId, whoopSleepId) — onConflictDoUpdate overwrites all fields
 * 4. Mark processed; on error mark failed
 */
export async function sleepProcessor(
  eventId: string,
  userId: string,
  whoopSleepId: string,
): Promise<void> {
  try {
    // 1. Check autoImportEnabled
    const [connection] = await db
      .select({ autoImportEnabled: whoopConnection.autoImportEnabled })
      .from(whoopConnection)
      .where(eq(whoopConnection.userId, userId))
      .limit(1);

    if (!connection?.autoImportEnabled) {
      console.log(
        `[whoop-webhook] Auto-import disabled for user ${userId}, skipping sleep event ${eventId}`,
      );
      await markEventSkipped(eventId);
      return;
    }

    // 2. Fetch sleep record from Whoop
    const accessToken = await getValidWhoopAccessToken(userId);
    const response = await fetch(
      `${WHOOP_API_BASE}/activity/sleep/${whoopSleepId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Whoop API error ${response.status}: ${text}`);
    }

    const sleepData = (await response.json()) as WhoopSleepDetail;
    const score = sleepData.score ?? null;
    const stageSummary = score?.stage_summary ?? null;

    // 3. Upsert by (userId, whoopSleepId)
    await db
      .insert(whoopSleep)
      .values({
        id: crypto.randomUUID(),
        userId,
        whoopSleepId: sleepData.id,
        start: new Date(sleepData.start),
        end: new Date(sleepData.end),
        nap: sleepData.nap ?? false,
        scoreState: sleepData.score_state ?? null,
        performancePct: score?.sleep_performance_percentage ?? null,
        consistencyPct: score?.sleep_consistency_percentage ?? null,
        efficiencyPct: score?.sleep_efficiency_percentage ?? null,
        respiratoryRate: score?.respiratory_rate ?? null,
        totalInBedMilli: stageSummary?.total_in_bed_time_milli ?? null,
        totalAwakeMilli: stageSummary?.total_awake_time_milli ?? null,
        lightSleepMilli: stageSummary?.total_light_sleep_time_milli ?? null,
        slowWaveMilli: stageSummary?.total_slow_wave_sleep_time_milli ?? null,
        remMilli: stageSummary?.total_rem_sleep_time_milli ?? null,
        noDataMilli: stageSummary?.total_no_data_time_milli ?? null,
        disturbanceCount: stageSummary?.disturbance_count ?? null,
      })
      .onConflictDoUpdate({
        target: [whoopSleep.userId, whoopSleep.whoopSleepId],
        set: {
          start: new Date(sleepData.start),
          end: new Date(sleepData.end),
          nap: sleepData.nap ?? false,
          scoreState: sleepData.score_state ?? null,
          performancePct: score?.sleep_performance_percentage ?? null,
          consistencyPct: score?.sleep_consistency_percentage ?? null,
          efficiencyPct: score?.sleep_efficiency_percentage ?? null,
          respiratoryRate: score?.respiratory_rate ?? null,
          totalInBedMilli: stageSummary?.total_in_bed_time_milli ?? null,
          totalAwakeMilli: stageSummary?.total_awake_time_milli ?? null,
          lightSleepMilli: stageSummary?.total_light_sleep_time_milli ?? null,
          slowWaveMilli: stageSummary?.total_slow_wave_sleep_time_milli ?? null,
          remMilli: stageSummary?.total_rem_sleep_time_milli ?? null,
          noDataMilli: stageSummary?.total_no_data_time_milli ?? null,
          disturbanceCount: stageSummary?.disturbance_count ?? null,
        },
      });

    // 4. Mark event processed
    await markEventProcessed(eventId);
    console.log(
      `[whoop-webhook] Processed sleep event ${eventId} for sleep ${whoopSleepId}`,
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(
      `[whoop-webhook] Failed to process sleep event ${eventId}:`,
      err,
    );
    await markEventFailed(eventId, errorMessage).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// sleepDeleteProcessor — handles sleep.deleted events
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Processes a sleep.deleted webhook event.
 *
 * Looks up the sleep row by (userId, whoopSleepId).
 * If found: deletes it.
 * If not found: no-op (idempotent).
 * Always marks event processed.
 */
export async function sleepDeleteProcessor(
  eventId: string,
  userId: string,
  whoopSleepId: string,
): Promise<void> {
  try {
    const [existingSleep] = await db
      .select({ id: whoopSleep.id })
      .from(whoopSleep)
      .where(
        and(
          eq(whoopSleep.userId, userId),
          eq(whoopSleep.whoopSleepId, whoopSleepId),
        ),
      )
      .limit(1);

    if (existingSleep) {
      await db.delete(whoopSleep).where(eq(whoopSleep.id, existingSleep.id));
      console.log(
        `[whoop-webhook] Deleted sleep ${existingSleep.id} for whoopSleepId ${whoopSleepId}`,
      );
    } else {
      console.log(
        `[whoop-webhook] sleep.deleted: no sleep found for whoopSleepId ${whoopSleepId} — marking processed (idempotent)`,
      );
    }

    await markEventProcessed(eventId);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(
      `[whoop-webhook] Failed to process sleep delete event ${eventId}:`,
      err,
    );
    await markEventFailed(eventId, errorMessage).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// recoveryProcessor — handles recovery.created and recovery.updated events
// ─────────────────────────────────────────────────────────────────────────────

interface WhoopRecoveryDetail {
  cycle_id: number | string;
  sleep_id?: number | string | null;
  created_at: string;
  updated_at: string;
  score_state?: string;
  score?: {
    recovery_score?: number;
    resting_heart_rate?: number;
    hrv_rmssd_milli?: number;
    spo2_percentage?: number;
    skin_temp_celsius?: number;
    user_calibrating?: boolean;
  } | null;
}

/**
 * Processes recovery.created and recovery.updated webhook events.
 *
 * Flow:
 * 1. Skip if autoImportEnabled = false → mark skipped
 * 2. Fetch recovery record from Whoop's recovery endpoint (keyed by cycle ID)
 * 3. Upsert by (userId, whoopCycleId) — onConflictDoUpdate overwrites all fields
 * 4. Mark processed; on error mark failed
 */
export async function recoveryProcessor(
  eventId: string,
  userId: string,
  whoopCycleId: string,
): Promise<void> {
  try {
    // 1. Check autoImportEnabled
    const [connection] = await db
      .select({ autoImportEnabled: whoopConnection.autoImportEnabled })
      .from(whoopConnection)
      .where(eq(whoopConnection.userId, userId))
      .limit(1);

    if (!connection?.autoImportEnabled) {
      console.log(
        `[whoop-webhook] Auto-import disabled for user ${userId}, skipping recovery event ${eventId}`,
      );
      await markEventSkipped(eventId);
      return;
    }

    // 2. Fetch recovery record from Whoop
    const accessToken = await getValidWhoopAccessToken(userId);
    const response = await fetch(`${WHOOP_API_BASE}/recovery/${whoopCycleId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Whoop API error ${response.status}: ${text}`);
    }

    const recoveryData = (await response.json()) as WhoopRecoveryDetail;
    const score = recoveryData.score ?? null;

    // 3. Upsert by (userId, whoopCycleId)
    await db
      .insert(whoopRecovery)
      .values({
        id: crypto.randomUUID(),
        userId,
        whoopCycleId: String(recoveryData.cycle_id),
        whoopSleepId:
          recoveryData.sleep_id != null ? String(recoveryData.sleep_id) : null,
        createdAt: new Date(recoveryData.created_at),
        updatedAt: new Date(recoveryData.updated_at),
        scoreState: recoveryData.score_state ?? null,
        recoveryScore: score?.recovery_score ?? null,
        restingHr: score?.resting_heart_rate ?? null,
        hrv: score?.hrv_rmssd_milli ?? null,
        spo2Pct: score?.spo2_percentage ?? null,
        skinTempCelsius: score?.skin_temp_celsius ?? null,
        userCalibrating: score?.user_calibrating ?? false,
      })
      .onConflictDoUpdate({
        target: [whoopRecovery.userId, whoopRecovery.whoopCycleId],
        set: {
          whoopSleepId:
            recoveryData.sleep_id != null
              ? String(recoveryData.sleep_id)
              : null,
          updatedAt: new Date(recoveryData.updated_at),
          scoreState: recoveryData.score_state ?? null,
          recoveryScore: score?.recovery_score ?? null,
          restingHr: score?.resting_heart_rate ?? null,
          hrv: score?.hrv_rmssd_milli ?? null,
          spo2Pct: score?.spo2_percentage ?? null,
          skinTempCelsius: score?.skin_temp_celsius ?? null,
          userCalibrating: score?.user_calibrating ?? false,
        },
      });

    // 4. Mark event processed
    await markEventProcessed(eventId);
    console.log(
      `[whoop-webhook] Processed recovery event ${eventId} for cycle ${whoopCycleId}`,
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(
      `[whoop-webhook] Failed to process recovery event ${eventId}:`,
      err,
    );
    await markEventFailed(eventId, errorMessage).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// recoveryDeleteProcessor — handles recovery.deleted events
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Processes a recovery.deleted webhook event.
 *
 * Looks up the recovery row by (userId, whoopCycleId).
 * If found: deletes it.
 * If not found: no-op (idempotent).
 * Always marks event processed.
 */
export async function recoveryDeleteProcessor(
  eventId: string,
  userId: string,
  whoopCycleId: string,
): Promise<void> {
  try {
    const [existingRecovery] = await db
      .select({ id: whoopRecovery.id })
      .from(whoopRecovery)
      .where(
        and(
          eq(whoopRecovery.userId, userId),
          eq(whoopRecovery.whoopCycleId, whoopCycleId),
        ),
      )
      .limit(1);

    if (existingRecovery) {
      await db
        .delete(whoopRecovery)
        .where(eq(whoopRecovery.id, existingRecovery.id));
      console.log(
        `[whoop-webhook] Deleted recovery ${existingRecovery.id} for whoopCycleId ${whoopCycleId}`,
      );
    } else {
      console.log(
        `[whoop-webhook] recovery.deleted: no recovery found for whoopCycleId ${whoopCycleId} — marking processed (idempotent)`,
      );
    }

    await markEventProcessed(eventId);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(
      `[whoop-webhook] Failed to process recovery delete event ${eventId}:`,
      err,
    );
    await markEventFailed(eventId, errorMessage).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// dispatchWhoopEvent — single place that maps eventType → processor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps an event type to the corresponding processor and invokes it.
 * Returns the promise if a processor was dispatched, or null if the event type
 * is unknown or has no resourceId.
 */
export function dispatchWhoopEvent(args: {
  eventId: string;
  userId: string;
  eventType: string;
  resourceId: string | null;
}): Promise<void> | null {
  const { eventId, userId, eventType, resourceId } = args;
  if (!resourceId) return null;

  switch (eventType) {
    case "workout.updated":
      return workoutProcessor(eventId, userId, resourceId);
    case "workout.deleted":
      return workoutDeleteProcessor(eventId, userId, resourceId);
    case "sleep.updated":
      return sleepProcessor(eventId, userId, resourceId);
    case "sleep.deleted":
      return sleepDeleteProcessor(eventId, userId, resourceId);
    case "recovery.updated":
      return recoveryProcessor(eventId, userId, resourceId);
    case "recovery.deleted":
      return recoveryDeleteProcessor(eventId, userId, resourceId);
    default:
      return null;
  }
}

whoopWebhookApp.post("/webhook", async (c) => {
  // 1. Buffer raw body before any parsing (required for HMAC)
  const rawBody = await c.req.text();

  // 2. Parse v2 payload: { user_id, id, type, trace_id }
  let parsed: WhoopWebhookPayload;
  try {
    parsed = JSON.parse(rawBody) as WhoopWebhookPayload;
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const whoopUserId = parsed.user_id != null ? String(parsed.user_id) : null;
  const resourceId = parsed.id ?? null; // UUID of workout/sleep/recovery
  const eventType = parsed.type ?? "unknown";
  const traceId = parsed.trace_id ?? null; // dedup key

  if (!whoopUserId || !traceId) {
    return c.json({ error: "Missing user_id or trace_id" }, 400);
  }

  // 3. Verify HMAC-SHA256 using the app-level shared secret (from Developer Dashboard)
  // v2 formula: base64(HMAC-SHA256(timestamp + rawBody, secret))
  // Headers: X-WHOOP-Signature, X-WHOOP-Signature-Timestamp
  const signatureHeader = c.req.header("X-WHOOP-Signature");
  const timestampHeader = c.req.header("X-WHOOP-Signature-Timestamp");

  if (!signatureHeader || !timestampHeader) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Whoop signs webhooks with the OAuth client secret (same as WHOOP_CLIENT_SECRET)
  const webhookSecret = env.WHOOP_CLIENT_SECRET;
  if (!webhookSecret) {
    console.error("[whoop-webhook] WHOOP_CLIENT_SECRET not configured");
    return c.json({ error: "Server configuration error" }, 500);
  }

  const timestampMs = parseWhoopTimestampMs(timestampHeader);
  if (
    timestampMs === null ||
    Math.abs(Date.now() - timestampMs) > WHOOP_REPLAY_WINDOW_MS
  ) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const expectedSig = createHmac("sha256", webhookSecret)
    .update(timestampHeader + rawBody)
    .digest("base64");

  if (!timingSafeEqual(expectedSig, signatureHeader)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // 4. Look up app user by Whoop user ID
  const [connection] = await db
    .select({
      id: whoopConnection.id,
      userId: whoopConnection.userId,
    })
    .from(whoopConnection)
    .where(eq(whoopConnection.whoopUserId, whoopUserId))
    .limit(1);

  if (!connection) {
    // Valid signature but no connected user — return 200 to stop retries
    console.log(
      `[whoop-webhook] No connection for whoopUserId ${whoopUserId}, ignoring`,
    );
    return c.json({ ok: true }, 200);
  }

  // 5. Insert event row using trace_id as PK (dedup — re-deliveries are no-ops)
  await db
    .insert(whoopWebhookEvent)
    .values({
      id: traceId,
      userId: connection.userId,
      eventType,
      whoopResourceId: resourceId,
      receivedAt: new Date(),
      status: "pending",
    })
    .onConflictDoNothing();

  // Update last received timestamp
  await db
    .update(whoopConnection)
    .set({ webhookLastReceivedAt: new Date() })
    .where(eq(whoopConnection.id, connection.id));

  // 6. Return 200 immediately, process async
  const userId = connection.userId;
  setImmediate(async () => {
    // Atomic claim — prevents double dispatch on deploy overlap with startup drain
    const result = await db
      .update(whoopWebhookEvent)
      .set({ status: "processing" })
      .where(
        and(
          eq(whoopWebhookEvent.id, traceId),
          eq(whoopWebhookEvent.status, "pending"),
        ),
      );

    if (result.rowCount === 0) return; // already claimed by drain or duplicate delivery

    const promise = dispatchWhoopEvent({
      eventId: traceId,
      userId,
      eventType,
      resourceId,
    });
    if (!promise) {
      await db
        .update(whoopWebhookEvent)
        .set({ status: "skipped", processedAt: new Date() })
        .where(eq(whoopWebhookEvent.id, traceId))
        .catch((err) =>
          console.error("[whoop-webhook] Failed to skip event:", err),
        );
      return;
    }
    trackInFlight(promise);
  });

  return c.json({ ok: true }, 200);
});
