import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@src/db";
import { exerciseLog, whoopConnection, workout } from "@src/db/schema/index";
import {
  whoopActivityToExerciseLog,
  whoopSportToCardioSubtype,
  whoopSportToWorkoutType,
} from "@src/shared";

import { protectedProcedure, router } from "../index";
import {
  WHOOP_API_BASE,
  getValidWhoopAccessToken,
  resolveWhoopExerciseId,
} from "../lib/whoop-client";
import { recordRunningPrs } from "../lib/personal-records";
import { recalculateProgressiveOverload } from "../lib/progressive-overload-db";
import { recalculateMuscleGroupVolumeForWeek } from "../lib/muscle-group-volume-db";
import { WORKOUT_TYPE_ENUM } from "../lib/workout-utils";
import { decryptToken } from "../lib/token-encryption";
import { env } from "@src/env/server";
import {
  getBackfillState,
  triggerBackfill,
  stopBackfill as stopBackfillState,
} from "../lib/whoop-backfill";

const WHOOP_WEBHOOK_API_BASE = "https://api.prod.whoop.com/developer/v1";

/** 7-day threshold for isValid */
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Deletes a Whoop webhook subscription. Best-effort — logs but does not throw.
 */
async function deleteWhoopSubscription(
  subscriptionId: string,
  accessToken: string,
): Promise<void> {
  try {
    const res = await fetch(
      `${WHOOP_WEBHOOK_API_BASE}/webhook/${subscriptionId}`,
      {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    if (!res.ok) {
      console.warn(
        `[whoop] Failed to delete subscription ${subscriptionId}: ${res.status}`,
      );
    }
  } catch (err) {
    console.warn(
      `[whoop] Error deleting subscription ${subscriptionId}:`,
      err,
    );
  }
}

const toIsoStart = (s: string) =>
  s.includes("T") ? s : `${s}T00:00:00.000Z`;
const toIsoEnd = (s: string) =>
  s.includes("T") ? s : `${s}T23:59:59.999Z`;

interface WhoopWorkoutRecord {
  id: string;
  start: string;
  end: string;
  sport_id: number;
  sport_name: string;
  score_state?: string;
  score?: {
    strain?: number;
    average_heart_rate?: number;
    max_heart_rate?: number;
    kilojoule?: number;
    percent_recorded?: number;
    distance_meter?: number;
    altitude_gain_meter?: number;
    altitude_change_meter?: number;
    zone_durations?: {
      zone_zero_milli?: number;
      zone_one_milli?: number;
      zone_two_milli?: number;
      zone_three_milli?: number;
      zone_four_milli?: number;
      zone_five_milli?: number;
    };
  } | null;
}

interface WhoopWorkoutListResponse {
  records: WhoopWorkoutRecord[];
  next_token: string | null;
}

export const whoopRouter = router({
  /**
   * Returns the webhook subscription status for the authenticated user.
   * isValid = subscribed AND (lastReceivedAt is within 7 days OR null but subscribed).
   */
  webhookStatus: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const [connection] = await db
      .select({
        webhookSubscriptionId: whoopConnection.webhookSubscriptionId,
        webhookLastReceivedAt: whoopConnection.webhookLastReceivedAt,
        autoImportEnabled: whoopConnection.autoImportEnabled,
        notifyOnAutoImport: whoopConnection.notifyOnAutoImport,
      })
      .from(whoopConnection)
      .where(eq(whoopConnection.userId, userId))
      .limit(1);

    if (!connection) {
      return {
        subscribed: false,
        isValid: false,
        lastReceivedAt: null,
        autoImportEnabled: false,
        notifyOnAutoImport: false,
        backfill: null,
      };
    }

    // v2 webhooks: Whoop signs with the OAuth client secret (WHOOP_CLIENT_SECRET).
    // "subscribed" = client secret is configured (required for signature verification).
    const subscribed = !!env.WHOOP_CLIENT_SECRET;
    const lastReceivedAt = connection.webhookLastReceivedAt ?? null;

    // isValid: secret configured, AND either never received (fresh) or received within 7 days
    let isValid = false;
    if (subscribed) {
      isValid = lastReceivedAt === null || Date.now() - lastReceivedAt.getTime() < SEVEN_DAYS_MS;
    }

    const backfillState = getBackfillState(userId);
    const backfill =
      backfillState?.running === true
        ? {
            running: backfillState.running,
            importedCount: backfillState.importedCount,
            totalCount: backfillState.totalCount,
          }
        : null;

    return {
      subscribed,
      isValid,
      lastReceivedAt,
      autoImportEnabled: connection.autoImportEnabled,
      notifyOnAutoImport: connection.notifyOnAutoImport,
      backfill,
    };
  }),

  /**
   * Updates the autoImportEnabled flag on the user's Whoop connection row.
   * Returns { ok: true } on success.
   */
  setAutoImport: protectedProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const updated = await db
        .update(whoopConnection)
        .set({ autoImportEnabled: input.enabled })
        .where(eq(whoopConnection.userId, userId));

      // If no rows were updated, the user has no Whoop connection
      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No Whoop connection found",
        });
      }

      return { ok: true };
    }),

  /**
   * Updates the notifyOnAutoImport flag on the user's Whoop connection row.
   * Returns { ok: true } on success.
   */
  setNotifyOnAutoImport: protectedProcedure
    .input(z.object({ enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const updated = await db
        .update(whoopConnection)
        .set({ notifyOnAutoImport: input.enabled })
        .where(eq(whoopConnection.userId, userId));

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No Whoop connection found",
        });
      }

      return { ok: true };
    }),

  /**
   * Whoop v2 webhooks are configured at the app level in the Whoop Developer Dashboard.
   * There is no per-user registration API. This mutation is a no-op kept for UI compatibility.
   * To fix a broken webhook, update WHOOP_WEBHOOK_SECRET in the server env and redeploy.
   */
  reregisterWebhook: protectedProcedure.mutation(async () => {
    throw new TRPCError({
      code: "METHOD_NOT_SUPPORTED",
      message:
        "Whoop v2 webhooks are configured in the Whoop Developer Dashboard, not via API. Update WHOOP_WEBHOOK_SECRET in your server environment to rotate the signing secret.",
    });
  }),

  /**
   * Triggers a backfill of Whoop activities for the past `days` days (default 30).
   * Fires async via setImmediate — returns { ok: true } immediately.
   */
  triggerBackfill: protectedProcedure
    .input(z.object({ days: z.number().min(1).max(90).default(30) }).optional())
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const days = input?.days ?? 30;

      setImmediate(() => {
        triggerBackfill(userId, days);
      });

      return { ok: true };
    }),

  /**
   * Signals the running backfill to stop at the next iteration.
   * Returns { ok: true } immediately.
   */
  stopBackfill: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    stopBackfillState(userId);
    return { ok: true };
  }),

  /**
   * Returns the current Whoop connection status for the authenticated user.
   */
  connectionStatus: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const [connection] = await db
      .select({
        isValid: whoopConnection.isValid,
        connectedAt: whoopConnection.connectedAt,
        lastImportedAt: whoopConnection.lastImportedAt,
      })
      .from(whoopConnection)
      .where(eq(whoopConnection.userId, userId))
      .limit(1);

    if (!connection) {
      return {
        connected: false,
        isValid: false,
        connectedAt: null,
        lastImportedAt: null,
      };
    }

    return {
      connected: true,
      isValid: connection.isValid,
      connectedAt: connection.connectedAt.toISOString(),
      lastImportedAt: connection.lastImportedAt?.toISOString() ?? null,
    };
  }),

  /**
   * Disconnects the Whoop integration.
   * Deletes the Whoop webhook subscription first (best-effort), then removes the local row.
   */
  disconnect: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const encryptionKey = env.TOKEN_ENCRYPTION_KEY;

    // Fetch the connection to get the subscription ID and access token
    const [connection] = await db
      .select({
        webhookSubscriptionId: whoopConnection.webhookSubscriptionId,
        accessToken: whoopConnection.accessToken,
        tokenExpiresAt: whoopConnection.tokenExpiresAt,
      })
      .from(whoopConnection)
      .where(eq(whoopConnection.userId, userId))
      .limit(1);

    // If there's an active subscription, delete it from Whoop first (best-effort)
    if (connection?.webhookSubscriptionId && encryptionKey) {
      try {
        // Decrypt the access token we already fetched — avoid a second DB round-trip
        const accessToken = decryptToken(connection.accessToken, encryptionKey);
        await deleteWhoopSubscription(connection.webhookSubscriptionId, accessToken);
      } catch (err) {
        console.warn("[whoop] Could not delete subscription on disconnect:", err);
      }
    }

    await db.delete(whoopConnection).where(eq(whoopConnection.userId, userId));

    return { success: true };
  }),

  /**
   * Lists Whoop workout activities for the authenticated user.
   * Supports optional date range filtering and cursor-based pagination.
   * Each activity is annotated with alreadyImported based on whoopActivityId.
   */
  listActivities: protectedProcedure
    .input(
      z.object({
        from: z.string().optional(), // ISO datetime string
        to: z.string().optional(), // ISO datetime string
        nextToken: z.string().optional(),
        limit: z.number().int().min(1).max(25).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Whoop v2 requires full ISO datetime strings, not date-only strings.
      // Use start-of-day for `from` and end-of-day for `to` so the full
      // selected day is included regardless of UTC offset.
      const params = new URLSearchParams();
      if (input.from) params.set("start", toIsoStart(input.from));
      if (input.to) params.set("end", toIsoEnd(input.to));
      if (input.nextToken) params.set("nextToken", input.nextToken);
      params.set("limit", String(input.limit));

      const accessToken = await getValidWhoopAccessToken(userId);

      const response = await fetch(
        `${WHOOP_API_BASE}/activity/workout?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`Whoop API error ${response.status}: ${text}`);
      }

      const data = (await response.json()) as WhoopWorkoutListResponse;
      const records = data.records ?? [];

      // Annotate with alreadyImported by checking whoopActivityId in workout table
      const whoopIds = records.map((r) => r.id);
      let importedIds = new Set<string>();

      if (whoopIds.length > 0) {
        const existingRows = await db
          .select({ whoopActivityId: workout.whoopActivityId })
          .from(workout)
          .where(
            and(
              eq(workout.userId, userId),
              inArray(workout.whoopActivityId, whoopIds),
            ),
          );
        importedIds = new Set(
          existingRows
            .map((r) => r.whoopActivityId)
            .filter((id): id is string => id !== null),
        );
      }

      const activities = records.map((record) => {
        const startMs = new Date(record.start).getTime();
        const endMs = new Date(record.end).getTime();
        const durationMinutes = Math.round((endMs - startMs) / 60_000);

        return {
          id: record.id,
          whoopActivityId: record.id,
          start: record.start,
          end: record.end,
          sportId: record.sport_id,
          sportName: record.sport_name,
          workoutType: whoopSportToWorkoutType(
            record.sport_id,
            record.sport_name,
          ),
          durationMinutes,
          strain: record.score?.strain ?? null,
          averageHeartRate: record.score?.average_heart_rate ?? null,
          maxHeartRate: record.score?.max_heart_rate ?? null,
          alreadyImported: importedIds.has(record.id),
        };
      });

      return {
        activities,
        nextToken: data.next_token ?? null,
      };
    }),

  /**
   * Commits a Whoop import. Accepts either:
   *   - An explicit list of activity IDs (with optional per-activity type overrides), or
   *   - { selectAll: true, from?, to? } to fetch all activities in the date range server-side.
   * Deduplicates by whoopActivityId, creates workouts transactionally, updates lastImportedAt,
   * and fires fire-and-forget progressive overload + muscle group volume recalculation.
   */
  commit: protectedProcedure
    .input(
      z.union([
        // Explicit activity list
        z.object({
          selectAll: z.literal(false).optional(),
          activityIds: z.array(z.string()).min(1),
          typeOverrides: z
            .record(
              z.string(),
              WORKOUT_TYPE_ENUM,
            )
            .optional(),
          from: z.string().optional(),
          to: z.string().optional(),
        }),
        // Select all in date range
        z.object({
          selectAll: z.literal(true),
          activityIds: z.array(z.string()).optional(),
          typeOverrides: z
            .record(
              z.string(),
              WORKOUT_TYPE_ENUM,
            )
            .optional(),
          from: z.string().optional(),
          to: z.string().optional(),
        }),
      ]),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // --- Step 1: Collect all Whoop activities to process ---
      let activitiesToProcess: WhoopWorkoutRecord[] = [];

      const accessToken = await getValidWhoopAccessToken(userId);

      if (input.selectAll) {
        // Fetch all pages from Whoop API for the given date range
        let pageToken: string | null = null;
        do {
          const params = new URLSearchParams();
          if (input.from) params.set("start", toIsoStart(input.from));
          if (input.to) params.set("end", toIsoEnd(input.to));
          if (pageToken) params.set("nextToken", pageToken);
          params.set("limit", "25");

          const response = await fetch(
            `${WHOOP_API_BASE}/activity/workout?${params.toString()}`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
          );

          if (!response.ok) {
            const text = await response.text().catch(() => "");
            throw new Error(`Whoop API error ${response.status}: ${text}`);
          }

          const data = (await response.json()) as WhoopWorkoutListResponse;
          activitiesToProcess.push(...(data.records ?? []));
          pageToken = data.next_token ?? null;
        } while (pageToken !== null);
      } else {
        // Fetch only the explicitly requested activity IDs
        // We fetch them individually since Whoop API doesn't support batch-by-ID
        const activityIds = input.activityIds ?? [];
        for (const id of activityIds) {
          const response = await fetch(
            `${WHOOP_API_BASE}/activity/workout/${id}`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
          );

          if (!response.ok) {
            // Skip activities that fail to fetch individually
            console.warn(
              `Whoop: failed to fetch activity ${id}: ${response.status}`,
            );
            continue;
          }

          const record = (await response.json()) as WhoopWorkoutRecord;
          activitiesToProcess.push(record);
        }
      }

      if (activitiesToProcess.length === 0) {
        return { createdCount: 0, skippedCount: 0 };
      }

      // --- Step 2: Deduplicate against already-imported IDs ---
      const candidateWhoopIds = activitiesToProcess.map((r) => r.id);
      const existingRows = await db
        .select({ whoopActivityId: workout.whoopActivityId })
        .from(workout)
        .where(
          and(
            eq(workout.userId, userId),
            inArray(workout.whoopActivityId, candidateWhoopIds),
          ),
        );
      const alreadyImportedIds = new Set(
        existingRows
          .map((r) => r.whoopActivityId)
          .filter((id): id is string => id !== null),
      );

      const newActivities = activitiesToProcess.filter(
        (r) => !alreadyImportedIds.has(r.id),
      );
      const skippedCount = activitiesToProcess.length - newActivities.length;

      if (newActivities.length === 0) {
        return { createdCount: 0, skippedCount };
      }

      const typeOverrides = input.typeOverrides ?? {};

      // --- Step 3: Build workout rows and insert in a single transaction ---
      const insertedWorkoutDates: Date[] = [];
      const insertedExerciseIds = new Set<string>();

      await db.transaction(async (tx) => {
        for (const record of newActivities) {
          // Use the shared DTO so the exercise log mirrors the webhook/backfill
          // output exactly (distanceMeter, hrZoneDurations, normalized intensity).
          const patch = whoopActivityToExerciseLog(record);
          const durationMinutes = patch.durationMinutes;

          const workoutType =
            typeOverrides[record.id] ??
            whoopSportToWorkoutType(record.sport_id, record.sport_name);

          // Resolve the canonical library exercise (Short Run / Long Run / etc.)
          // based on sport + distance, so the log gets a real exerciseId and is
          // visible to cardio analytics.
          const resolvedExercise = await resolveWhoopExerciseId(
            record.sport_id,
            record.sport_name,
            patch.distanceMeter,
          );

          const strain = record.score?.strain ?? null;
          const avgHR = patch.heartRate;

          // Auto-generated notes
          const noteParts: string[] = [
            `Imported from Whoop. Sport: ${record.sport_name}.`,
          ];
          if (strain !== null) noteParts.push(`Strain: ${strain.toFixed(1)}.`);
          if (avgHR !== null) noteParts.push(`Avg HR: ${avgHR} bpm.`);
          const notes = noteParts.join(" ");

          const workoutId = crypto.randomUUID();
          const workoutDate = new Date(record.start);

          await tx.insert(workout).values({
            id: workoutId,
            userId,
            date: workoutDate,
            workoutType,
            durationMinutes: durationMinutes ?? undefined,
            notes,
            source: "whoop",
            whoopActivityId: record.id,
            // Whoop activities carry no weighted sets — volume is always null (KOI-82).
            totalVolume: null,
          });

          // Insert a single exercise log row for the Whoop activity, structurally
          // identical to the webhook/backfill import paths.
          const logId = crypto.randomUUID();
          await tx.insert(exerciseLog).values({
            id: logId,
            workoutId,
            exerciseId: resolvedExercise?.id ?? undefined,
            exerciseName: resolvedExercise?.name ?? record.sport_name,
            order: 0,
            heartRate: avgHR,
            intensity: patch.intensity,
            distanceMeter: patch.distanceMeter,
            durationMinutes,
            hrZoneDurations: patch.hrZoneDurations,
          });

          // Record running PRs (longest distance + best pace) when this is a
          // resolved running activity, mirroring the workouts.create path.
          if (
            resolvedExercise &&
            whoopSportToCardioSubtype(record.sport_id, record.sport_name) ===
              "running"
          ) {
            await recordRunningPrs(tx, {
              userId,
              exerciseId: resolvedExercise.id,
              workoutId,
              dateAchieved: workoutDate,
              distanceMeter: patch.distanceMeter,
              durationMinutes,
            });
          }

          if (resolvedExercise) insertedExerciseIds.add(resolvedExercise.id);
          insertedWorkoutDates.push(workoutDate);
        }

        // Update lastImportedAt inside the transaction so it only advances on success
        await tx
          .update(whoopConnection)
          .set({ lastImportedAt: new Date() })
          .where(eq(whoopConnection.userId, userId));
      });

      // --- Step 4: Fire-and-forget recalculations ---
      const uniqueWeekStarts = new Set(
        insertedWorkoutDates.map((d) => {
          const day = d.getDay();
          const diff = d.getDate() - day + (day === 0 ? -6 : 1);
          return new Date(d.getFullYear(), d.getMonth(), diff)
            .toISOString()
            .slice(0, 10);
        }),
      );

      for (const weekStart of uniqueWeekStarts) {
        recalculateMuscleGroupVolumeForWeek(userId, new Date(weekStart)).catch(
          (err) =>
            console.error(
              "Whoop import: muscle group volume recalc failed:",
              err,
            ),
        );
      }

      // Trigger progressive overload recalc for the exercises we resolved + inserted.
      recalculateProgressiveOverload(
        userId,
        Array.from(insertedExerciseIds),
      ).catch((err) =>
        console.error("Whoop import: progressive overload recalc failed:", err),
      );

      return { createdCount: newActivities.length, skippedCount };
    }),

  /**
   * Lists Whoop cardio/running activities within ±3 days of a given date.
   * Filters to activities where whoopSportToWorkoutType returns 'cardio' or 'hiit'.
   * Annotates each with alreadyLinked based on workout.whoopActivityId for this user.
   */
  listUnlinkedCardioActivities: protectedProcedure
    .input(
      z.object({
        date: z.string(), // ISO date string, e.g. "2026-04-28"
        nextToken: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const accessToken = await getValidWhoopAccessToken(userId);

      // ±3 days window
      const centerDate = new Date(input.date);
      const startDate = new Date(centerDate);
      startDate.setDate(centerDate.getDate() - 3);
      const endDate = new Date(centerDate);
      endDate.setDate(centerDate.getDate() + 3);

      const params = new URLSearchParams();
      params.set(
        "start",
        startDate.toISOString().replace(/T.*$/, "T00:00:00.000Z"),
      );
      params.set(
        "end",
        endDate.toISOString().replace(/T.*$/, "T23:59:59.999Z"),
      );
      params.set("limit", "25");
      if (input.nextToken) params.set("nextToken", input.nextToken);

      const response = await fetch(
        `${WHOOP_API_BASE}/activity/workout?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: `Whoop API error ${response.status}: ${text}`,
        });
      }

      const data = (await response.json()) as WhoopWorkoutListResponse;
      const records = data.records ?? [];

      // Filter to cardio or hiit activity types only
      const cardioRecords = records.filter((r) => {
        const workoutType = whoopSportToWorkoutType(r.sport_id, r.sport_name);
        return workoutType === "cardio" || workoutType === "hiit";
      });

      // Annotate with alreadyLinked + linked workout info
      const whoopIds = cardioRecords.map((r) => r.id);
      // Map whoopActivityId → { workoutId, workoutDate }
      const linkedMap = new Map<
        string,
        { workoutId: string; workoutDate: string }
      >();

      if (whoopIds.length > 0) {
        const existingRows = await db
          .select({
            whoopActivityId: workout.whoopActivityId,
            id: workout.id,
            date: workout.date,
          })
          .from(workout)
          .where(
            and(
              eq(workout.userId, userId),
              inArray(workout.whoopActivityId, whoopIds),
            ),
          );
        for (const row of existingRows) {
          if (row.whoopActivityId) {
            linkedMap.set(row.whoopActivityId, {
              workoutId: row.id,
              workoutDate: row.date.toISOString().slice(0, 10),
            });
          }
        }
      }

      const activities = cardioRecords.map((record) => {
        const startMs = new Date(record.start).getTime();
        const endMs = new Date(record.end).getTime();
        const durationMinutes = Math.round((endMs - startMs) / 60_000);
        const linked = linkedMap.get(record.id) ?? null;

        return {
          id: record.id,
          start: record.start,
          end: record.end,
          sportName: record.sport_name,
          durationMinutes,
          strain: record.score?.strain ?? null,
          averageHeartRate: record.score?.average_heart_rate ?? null,
          distanceMeter: record.score?.distance_meter ?? null,
          alreadyLinked: linked !== null,
          linkedWorkoutId: linked?.workoutId ?? null,
          linkedWorkoutDate: linked?.workoutDate ?? null,
        };
      });

      return {
        activities,
        nextToken: data.next_token ?? null,
      };
    }),

  /**
   * Links a Whoop activity to an existing workout.
   * Fetches the Whoop activity detail, runs the DTO, and writes metrics to
   * the first exercise log row. Returns metricConflict: true if the exercise
   * log already has heartRate or intensity set and force is false.
   */
  linkToWorkout: protectedProcedure
    .input(
      z.object({
        workoutId: z.string().uuid(),
        whoopActivityId: z.string(),
        force: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify the workout belongs to the user
      const [targetWorkout] = await db
        .select({
          id: workout.id,
          whoopActivityId: workout.whoopActivityId,
        })
        .from(workout)
        .where(and(eq(workout.id, input.workoutId), eq(workout.userId, userId)))
        .limit(1);

      if (!targetWorkout) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workout not found",
        });
      }

      // Fetch the Whoop activity detail
      const accessToken = await getValidWhoopAccessToken(userId);

      const response = await fetch(
        `${WHOOP_API_BASE}/activity/workout/${input.whoopActivityId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: `Whoop API error ${response.status}: ${text}`,
        });
      }

      const whoopActivity = (await response.json()) as WhoopWorkoutRecord;

      // Run the DTO to get the exercise log patch
      const patch = whoopActivityToExerciseLog(whoopActivity);

      // Get the first exercise log row for this workout
      const [firstLog] = await db
        .select({
          id: exerciseLog.id,
          heartRate: exerciseLog.heartRate,
          intensity: exerciseLog.intensity,
        })
        .from(exerciseLog)
        .where(eq(exerciseLog.workoutId, input.workoutId))
        .limit(1);

      if (!firstLog) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "No exercise log found for this workout",
        });
      }

      // Check for metric conflicts
      const hasExistingMetrics =
        (firstLog.heartRate !== null && firstLog.heartRate !== undefined) ||
        (firstLog.intensity !== null && firstLog.intensity !== undefined);

      if (hasExistingMetrics && !input.force) {
        return { success: false as const, metricConflict: true as const };
      }

      // Write to the database in a transaction
      try {
        await db.transaction(async (tx) => {
          // Update the exercise log with Whoop metrics
          await tx
            .update(exerciseLog)
            .set({
              heartRate: patch.heartRate,
              intensity: patch.intensity,
              distanceMeter: patch.distanceMeter,
              durationMinutes: patch.durationMinutes,
              hrZoneDurations: patch.hrZoneDurations,
            })
            .where(eq(exerciseLog.id, firstLog.id));

          // Set whoopActivityId on the workout
          await tx
            .update(workout)
            .set({ whoopActivityId: input.whoopActivityId })
            .where(eq(workout.id, input.workoutId));
        });
      } catch (err: unknown) {
        // Unique constraint violation: same Whoop activity already linked to another workout
        const pgError = err as { code?: string; constraint?: string };
        if (
          pgError?.code === "23505" ||
          (typeof (err as { message?: string })?.message === "string" &&
            (err as { message: string }).message.includes(
              "workout_userId_whoopActivityId_unique_idx",
            ))
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Whoop activity ${input.whoopActivityId} is already linked to another workout for this user`,
          });
        }
        throw err;
      }

      return { success: true as const, metricConflict: false as const };
    }),

  /**
   * Unlinks a Whoop activity from a workout.
   * Clears workout.whoopActivityId and nulls all Whoop-sourced fields on the
   * first exercise log row. No-op if the workout has no whoopActivityId.
   */
  unlinkFromWorkout: protectedProcedure
    .input(
      z.object({
        workoutId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify the workout belongs to the user and get its current whoopActivityId
      const [targetWorkout] = await db
        .select({
          id: workout.id,
          whoopActivityId: workout.whoopActivityId,
        })
        .from(workout)
        .where(and(eq(workout.id, input.workoutId), eq(workout.userId, userId)))
        .limit(1);

      if (!targetWorkout) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workout not found",
        });
      }

      // No-op if not linked
      if (!targetWorkout.whoopActivityId) {
        return { success: true as const };
      }

      // Get the first exercise log row for this workout
      const [firstLog] = await db
        .select({ id: exerciseLog.id })
        .from(exerciseLog)
        .where(eq(exerciseLog.workoutId, input.workoutId))
        .limit(1);

      await db.transaction(async (tx) => {
        // Clear Whoop-sourced fields on the exercise log
        if (firstLog) {
          await tx
            .update(exerciseLog)
            .set({
              heartRate: null,
              intensity: null,
              distanceMeter: null,
              durationMinutes: null,
              hrZoneDurations: null,
            })
            .where(eq(exerciseLog.id, firstLog.id));
        }

        // Clear whoopActivityId on the workout
        await tx
          .update(workout)
          .set({ whoopActivityId: null })
          .where(eq(workout.id, input.workoutId));
      });

      return { success: true as const };
    }),
});
