import { z } from "zod";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";

import { db } from "@src/db";
import {
  exercise,
  muscleGroupVolume,
  personalRecord,
  progressiveOverloadState,
  workout,
} from "@src/db/schema/index";

import { protectedProcedure, router } from "../index";
import {
  aggregateVolumeByWeek,
  aggregateVolumeByMonth,
  calculateStreaks,
  buildFrequencyMap,
  getTodayLocalDateString,
  groupPersonalRecordsByExercise,
} from "../lib/analytics-queries";

function toLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

export const analyticsRouter = router({
  personalRecords: protectedProcedure
    .input(
      z
        .object({
          exerciseId: z.string().uuid().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const clauses = [eq(personalRecord.userId, ctx.session.user.id)];

      if (input?.exerciseId) {
        clauses.push(eq(personalRecord.exerciseId, input.exerciseId));
      }

      const rows = await db
        .select({
          id: personalRecord.id,
          exerciseId: personalRecord.exerciseId,
          recordType: personalRecord.recordType,
          value: personalRecord.value,
          previousRecordValue: personalRecord.previousRecordValue,
          dateAchieved: personalRecord.dateAchieved,
          exerciseName: exercise.name,
        })
        .from(personalRecord)
        .leftJoin(exercise, eq(personalRecord.exerciseId, exercise.id))
        .where(and(...clauses));

      return groupPersonalRecordsByExercise(rows);
    }),
  progressiveOverload: protectedProcedure
    .input(
      z
        .object({
          exerciseId: z.string().uuid().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const clauses = [
        eq(progressiveOverloadState.userId, ctx.session.user.id),
      ];
      if (input?.exerciseId) {
        clauses.push(
          eq(progressiveOverloadState.exerciseId, input.exerciseId),
        );
      }

      const rows = await db
        .select({
          exerciseId: progressiveOverloadState.exerciseId,
          trendStatus: progressiveOverloadState.trendStatus,
          plateauCount: progressiveOverloadState.plateauCount,
          nextSuggestedProgression:
            progressiveOverloadState.nextSuggestedProgression,
          lastCalculatedAt: progressiveOverloadState.lastCalculatedAt,
          exerciseName: exercise.name,
        })
        .from(progressiveOverloadState)
        .leftJoin(
          exercise,
          eq(progressiveOverloadState.exerciseId, exercise.id),
        )
        .where(and(...clauses));

      return rows.map((row) => ({
        exerciseId: row.exerciseId,
        exerciseName: row.exerciseName,
        trendStatus: row.trendStatus,
        plateauCount: row.plateauCount,
        suggestion: row.nextSuggestedProgression as {
          type: string;
          message: string;
          details: { currentValue: number; suggestedValue: number; unit: string };
        } | null,
        lastCalculatedAt: row.lastCalculatedAt,
      }));
    }),
  exerciseSuggestion: protectedProcedure
    .input(z.object({ exerciseId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [row] = await db
        .select({
          trendStatus: progressiveOverloadState.trendStatus,
          nextSuggestedProgression:
            progressiveOverloadState.nextSuggestedProgression,
          lastCalculatedAt: progressiveOverloadState.lastCalculatedAt,
        })
        .from(progressiveOverloadState)
        .where(
          and(
            eq(progressiveOverloadState.userId, ctx.session.user.id),
            eq(progressiveOverloadState.exerciseId, input.exerciseId),
          ),
        )
        .limit(1);

      if (!row) return null;

      return {
        trendStatus: row.trendStatus as "improving" | "plateau" | "declining",
        suggestion: row.nextSuggestedProgression as {
          type: string;
          message: string;
          details: { currentValue: number; suggestedValue: number; unit: string };
        } | null,
        lastCalculatedAt: row.lastCalculatedAt,
      };
    }),
  muscleGroupVolume: protectedProcedure
    .input(
      z
        .object({
          startDate: z.coerce.date().optional(),
          endDate: z.coerce.date().optional(),
          categorizationSystem: z
            .enum(["bodybuilding", "movement_patterns"])
            .optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const clauses = [eq(muscleGroupVolume.userId, ctx.session.user.id)];

      if (input?.startDate) {
        clauses.push(
          sql`${muscleGroupVolume.weekStartDate} >= ${input.startDate.toISOString().split("T")[0]}`,
        );
      }

      if (input?.endDate) {
        clauses.push(
          sql`${muscleGroupVolume.weekStartDate} <= ${input.endDate.toISOString().split("T")[0]}`,
        );
      }

      if (input?.categorizationSystem) {
        clauses.push(
          eq(muscleGroupVolume.categorizationSystem, input.categorizationSystem),
        );
      }

      return db
        .select()
        .from(muscleGroupVolume)
        .where(and(...clauses));
    }),
  volumeOverTime: protectedProcedure
    .input(
      z.object({
        granularity: z.enum(["weekly", "monthly"]),
        startDate: z.coerce.date().optional(),
        endDate: z.coerce.date().optional(),
        workoutType: z
          .enum([
            "weightlifting",
            "hiit",
            "cardio",
            "calisthenics",
            "yoga",
            "sports",
            "mixed",
          ])
          .optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const clauses = [eq(workout.userId, ctx.session.user.id)];

      if (input.startDate) {
        clauses.push(gte(workout.date, input.startDate));
      }

      if (input.endDate) {
        clauses.push(lte(workout.date, input.endDate));
      }

      if (input.workoutType) {
        clauses.push(eq(workout.workoutType, input.workoutType));
      }

      const rows = await db
        .select({
          date: workout.date,
          totalVolume: workout.totalVolume,
        })
        .from(workout)
        .where(and(...clauses))
        .orderBy(asc(workout.date));

      if (input.granularity === "weekly") {
        return aggregateVolumeByWeek(rows);
      }
      return aggregateVolumeByMonth(rows);
    }),
  workoutFrequency: protectedProcedure
    .input(
      z
        .object({
          startDate: z.coerce.date().optional(),
          endDate: z.coerce.date().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const now = new Date();
      const defaultStart = new Date(now);
      defaultStart.setFullYear(defaultStart.getFullYear() - 1);

      const clauses = [eq(workout.userId, ctx.session.user.id)];

      const startDate = input?.startDate ?? defaultStart;
      const endDate = input?.endDate ?? now;

      clauses.push(gte(workout.date, startDate));
      clauses.push(lte(workout.date, endDate));

      const rows = await db
        .select({
          date: workout.date,
          totalVolume: workout.totalVolume,
          durationMinutes: workout.durationMinutes,
        })
        .from(workout)
        .where(and(...clauses))
        .orderBy(asc(workout.date));

      const days = buildFrequencyMap(rows);

      const today = getTodayLocalDateString();
      const sortedDates = days.map((d) => d.date);
      const streaks = calculateStreaks(sortedDates, today);

      return { days, streaks };
    }),
  streaks: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db
      .select({ date: workout.date })
      .from(workout)
      .where(eq(workout.userId, ctx.session.user.id))
      .orderBy(asc(workout.date));

    const dates = rows.map((r) => {
      const d = r.date;
      return toLocalDateKey(d);
    });

    const today = getTodayLocalDateString();

    return calculateStreaks(dates, today);
  }),
});
