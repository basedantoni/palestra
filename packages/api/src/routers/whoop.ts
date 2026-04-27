import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@src/db";
import { exerciseLog, whoopConnection, workout } from "@src/db/schema/index";
import { whoopSportIdToWorkoutType } from "@src/shared";

import { protectedProcedure, router } from "../index";
import { WHOOP_API_BASE, getValidWhoopAccessToken } from "../lib/whoop-client";
import { recalculateProgressiveOverload } from "../lib/progressive-overload-db";
import { recalculateMuscleGroupVolumeForWeek } from "../lib/muscle-group-volume-db";

interface WhoopWorkoutRecord {
  id: string;
  start: string;
  end: string;
  sport_id: number;
  sport_name: string;
  score?: {
    strain?: number;
    average_heart_rate?: number;
    max_heart_rate?: number;
  } | null;
  score_state?: string;
}

interface WhoopWorkoutListResponse {
  records: WhoopWorkoutRecord[];
  next_token: string | null;
}

export const whoopRouter = router({
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
      return { connected: false, isValid: false, connectedAt: null, lastImportedAt: null };
    }

    return {
      connected: true,
      isValid: connection.isValid,
      connectedAt: connection.connectedAt.toISOString(),
      lastImportedAt: connection.lastImportedAt?.toISOString() ?? null,
    };
  }),

  /**
   * Disconnects the Whoop integration by deleting the connection row.
   */
  disconnect: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    await db
      .delete(whoopConnection)
      .where(eq(whoopConnection.userId, userId));

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
        to: z.string().optional(),   // ISO datetime string
        nextToken: z.string().optional(),
        limit: z.number().int().min(1).max(25).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Build Whoop API query params
      // Whoop v2 requires full ISO datetime strings, not date-only strings.
      // Use start-of-day for `from` and end-of-day for `to` so the full
      // selected day is included regardless of UTC offset.
      const toIsoStart = (s: string) =>
        s.includes("T") ? s : `${s}T00:00:00.000Z`;
      const toIsoEnd = (s: string) =>
        s.includes("T") ? s : `${s}T23:59:59.999Z`;

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
          workoutType: whoopSportIdToWorkoutType(record.sport_id),
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
          typeOverrides: z.record(z.string(), z.enum([
            "weightlifting", "hiit", "cardio", "calisthenics", "yoga", "sports", "mixed",
          ])).optional(),
          from: z.string().optional(),
          to: z.string().optional(),
        }),
        // Select all in date range
        z.object({
          selectAll: z.literal(true),
          activityIds: z.array(z.string()).optional(),
          typeOverrides: z.record(z.string(), z.enum([
            "weightlifting", "hiit", "cardio", "calisthenics", "yoga", "sports", "mixed",
          ])).optional(),
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

      const toIsoStart = (s: string) =>
        s.includes("T") ? s : `${s}T00:00:00.000Z`;
      const toIsoEnd = (s: string) =>
        s.includes("T") ? s : `${s}T23:59:59.999Z`;

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
            console.warn(`Whoop: failed to fetch activity ${id}: ${response.status}`);
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

      await db.transaction(async (tx) => {
        for (const record of newActivities) {
          const startMs = new Date(record.start).getTime();
          const endMs = new Date(record.end).getTime();
          const durationMinutes = Math.round((endMs - startMs) / 60_000);

          const workoutType =
            typeOverrides[record.id] ?? whoopSportIdToWorkoutType(record.sport_id);

          // Normalize strain (0–21 scale) to intensity (0–10 scale) then to 0–100
          const strain = record.score?.strain ?? null;
          const intensityOutOf10 =
            strain !== null ? Math.min(10, Math.max(0, strain)) : null;
          const intensity =
            intensityOutOf10 !== null
              ? Math.round(intensityOutOf10 * 10)
              : null;

          const avgHR = record.score?.average_heart_rate ?? null;

          // Auto-generated notes
          const noteParts: string[] = [`Imported from Whoop. Sport: ${record.sport_name}.`];
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
            durationMinutes,
            notes,
            source: "whoop",
            whoopActivityId: record.id,
          });

          // Insert a single exercise log row for the Whoop activity
          const logId = crypto.randomUUID();
          await tx.insert(exerciseLog).values({
            id: logId,
            workoutId,
            exerciseName: record.sport_name,
            order: 0,
            heartRate: avgHR,
            intensity,
            durationMinutes,
          });

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
          (err) => console.error("Whoop import: muscle group volume recalc failed:", err),
        );
      }

      // No exercise IDs (Whoop activities have no mapped exercises), but we still trigger
      // progressive overload for completeness in case the user has mapped exercises later.
      recalculateProgressiveOverload(userId, []).catch(
        (err) => console.error("Whoop import: progressive overload recalc failed:", err),
      );

      return { createdCount: newActivities.length, skippedCount };
    }),
});
