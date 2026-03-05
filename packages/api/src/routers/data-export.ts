import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@src/db";

import { rowsToCsv } from "../lib/export-utils";
import { protectedProcedure, router } from "../index";

export const dataExportRouter = router({
  generateJson: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const [profile, preferences, workouts, templates, personalRecords, overloadStates, muscleGroupVolumes] =
      await Promise.all([
        db.query.user.findFirst({
          where: (table, { eq }) => eq(table.id, userId),
        }),
        db.query.userPreferences.findFirst({
          where: (table, { eq }) => eq(table.userId, userId),
        }),
        db.query.workout.findMany({
          where: (table, { eq }) => eq(table.userId, userId),
          with: {
            logs: {
              with: {
                sets: true,
              },
            },
          },
        }),
        db.query.workoutTemplate.findMany({
          where: (table, { eq }) => eq(table.userId, userId),
          with: {
            exercises: true,
          },
        }),
        db.query.personalRecord.findMany({
          where: (table, { eq }) => eq(table.userId, userId),
        }),
        db.query.progressiveOverloadState.findMany({
          where: (table, { eq }) => eq(table.userId, userId),
        }),
        db.query.muscleGroupVolume.findMany({
          where: (table, { eq }) => eq(table.userId, userId),
        }),
      ]);

    const customExercises = await db.query.exercise.findMany({
      where: (table) => eq(table.createdByUserId, userId),
    });

    return {
      generatedAt: new Date().toISOString(),
      schemaVersion: "1",
      userId,
      data: {
        profile: profile
          ? {
              id: profile.id,
              name: profile.name,
              email: profile.email,
              emailVerified: profile.emailVerified,
              createdAt: profile.createdAt,
              updatedAt: profile.updatedAt,
            }
          : null,
        preferences: preferences ?? null,
        workouts,
        templates,
        customExercises,
        personalRecords,
        progressiveOverload: overloadStates,
        muscleGroupVolumes,
      },
    };
  }),
  generateCsv: protectedProcedure
    .input(
      z.object({
        dataset: z.enum(["workouts", "templates"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const datePart = new Date().toISOString().slice(0, 10);

      if (input.dataset === "workouts") {
        const workouts = await db.query.workout.findMany({
          where: (table, { eq }) => eq(table.userId, userId),
          with: {
            logs: {
              with: {
                sets: true,
              },
            },
          },
        });

        const rows: Array<Record<string, unknown>> = [];
        for (const workout of workouts) {
          if (workout.logs.length === 0) {
            rows.push({
              workout_id: workout.id,
              workout_date: workout.date.toISOString(),
              workout_type: workout.workoutType,
              workout_notes: workout.notes,
              exercise_order: null,
              exercise_name: null,
              set_number: null,
              reps: null,
              weight: null,
              rpe: null,
              total_volume: workout.totalVolume,
            });
            continue;
          }

          for (const log of workout.logs) {
            if (log.sets.length === 0) {
              rows.push({
                workout_id: workout.id,
                workout_date: workout.date.toISOString(),
                workout_type: workout.workoutType,
                workout_notes: workout.notes,
                exercise_order: log.order,
                exercise_name: log.exerciseName,
                set_number: null,
                reps: null,
                weight: null,
                rpe: null,
                total_volume: workout.totalVolume,
              });
              continue;
            }

            for (const set of log.sets) {
              rows.push({
                workout_id: workout.id,
                workout_date: workout.date.toISOString(),
                workout_type: workout.workoutType,
                workout_notes: workout.notes,
                exercise_order: log.order,
                exercise_name: log.exerciseName,
                set_number: set.setNumber,
                reps: set.reps,
                weight: set.weight,
                rpe: set.rpe,
                total_volume: workout.totalVolume,
              });
            }
          }
        }

        const csv = rowsToCsv(rows, [
          "workout_id",
          "workout_date",
          "workout_type",
          "workout_notes",
          "exercise_order",
          "exercise_name",
          "set_number",
          "reps",
          "weight",
          "rpe",
          "total_volume",
        ]);

        return {
          dataset: input.dataset,
          fileName: `fitness-workouts-${datePart}.csv`,
          content: csv,
        };
      }

      const templates = await db.query.workoutTemplate.findMany({
        where: (table, { eq }) => eq(table.userId, userId),
        with: {
          exercises: true,
        },
      });

      const rows: Array<Record<string, unknown>> = [];
      for (const template of templates) {
        if (template.exercises.length === 0) {
          rows.push({
            template_id: template.id,
            template_name: template.name,
            workout_type: template.workoutType,
            notes: template.notes,
            is_system_template: template.isSystemTemplate,
            exercise_order: null,
            exercise_id: null,
            default_sets: null,
          });
          continue;
        }

        for (const exercise of template.exercises) {
          rows.push({
            template_id: template.id,
            template_name: template.name,
            workout_type: template.workoutType,
            notes: template.notes,
            is_system_template: template.isSystemTemplate,
            exercise_order: exercise.order,
            exercise_id: exercise.exerciseId,
            default_sets: exercise.defaultSets,
          });
        }
      }

      const csv = rowsToCsv(rows, [
        "template_id",
        "template_name",
        "workout_type",
        "notes",
        "is_system_template",
        "exercise_order",
        "exercise_id",
        "default_sets",
      ]);

      return {
        dataset: input.dataset,
        fileName: `fitness-templates-${datePart}.csv`,
        content: csv,
      };
    }),
});
