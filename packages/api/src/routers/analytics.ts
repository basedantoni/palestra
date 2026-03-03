import { z } from "zod";
import { and, eq, sql } from "drizzle-orm";

import { db } from "@src/db";
import {
  exercise,
  muscleGroupVolume,
  personalRecord,
  progressiveOverloadState,
} from "@src/db/schema/index";

import { protectedProcedure, router } from "../index";

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
      if (input?.exerciseId) {
        return db
          .select()
          .from(personalRecord)
          .where(
            and(
              eq(personalRecord.userId, ctx.session.user.id),
              eq(personalRecord.exerciseId, input.exerciseId),
            ),
          );
      }

      return db
        .select()
        .from(personalRecord)
        .where(eq(personalRecord.userId, ctx.session.user.id));
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
});
