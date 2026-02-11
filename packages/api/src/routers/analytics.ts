import { z } from "zod";
import { and, eq, gte, lte } from "drizzle-orm";

import { db } from "@src/db";
import {
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
      if (input?.exerciseId) {
        return db
          .select()
          .from(progressiveOverloadState)
          .where(
            and(
              eq(progressiveOverloadState.userId, ctx.session.user.id),
              eq(progressiveOverloadState.exerciseId, input.exerciseId),
            ),
          );
      }

      return db
        .select()
        .from(progressiveOverloadState)
        .where(eq(progressiveOverloadState.userId, ctx.session.user.id));
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
        clauses.push(gte(muscleGroupVolume.weekStartDate, input.startDate));
      }

      if (input?.endDate) {
        clauses.push(lte(muscleGroupVolume.weekStartDate, input.endDate));
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
