import { z } from "zod";
import { and, eq, gte, lte, or } from "drizzle-orm";

import { db } from "@src/db";
import { exercise, exerciseLog, exerciseSet, workout } from "@src/db/schema/index";

import { protectedProcedure, router } from "../index";
import { parseWorkoutMarkdown } from "../lib/workout-import-parser";
import { resolveExerciseNames } from "../lib/fuzzy-match";
import { recalculateProgressiveOverload } from "../lib/progressive-overload-db";
import { recalculateMuscleGroupVolumeForWeek } from "../lib/muscle-group-volume-db";

export const importRouter = router({
  /**
   * Step 1: Parse markdown text into structured data.
   * Input: raw markdown string
   * Output: parsed workouts + unique exercise names + warnings
   */
  parse: protectedProcedure
    .input(
      z.object({
        markdown: z.string().min(1).max(500_000),
      }),
    )
    .mutation(async ({ input }) => {
      const result = parseWorkoutMarkdown(input.markdown);
      return {
        workouts: result.workouts.map((w) => ({
          date: w.date.toISOString(),
          exercises: w.exercises,
          isRestDay: w.isRestDay,
          rawText: w.rawText,
        })),
        uniqueExerciseNames: result.uniqueExerciseNames,
        parseWarnings: result.parseWarnings,
      };
    }),

  /**
   * Step 2: Fuzzy match parsed names against the exercise library.
   * Input: array of unique exercise names
   * Output: resolution suggestions per name
   */
  resolveExercises: protectedProcedure
    .input(
      z.object({
        exerciseNames: z.array(z.string().min(1)),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Fetch all exercises visible to this user (global + their custom)
      const allExercises = await db
        .select({
          id: exercise.id,
          name: exercise.name,
          category: exercise.category,
          exerciseType: exercise.exerciseType,
        })
        .from(exercise)
        .where(
          or(
            eq(exercise.isCustom, false),
            eq(exercise.createdByUserId, ctx.session.user.id),
          ),
        );

      return resolveExerciseNames(input.exerciseNames, allExercises);
    }),

  /**
   * Step 2b: Check for existing workouts on the same dates as the import.
   * Returns ISO date strings of dates that already have workouts.
   */
  checkDuplicateDates: protectedProcedure
    .input(
      z.object({
        dates: z.array(z.string()), // ISO date strings
      }),
    )
    .query(async ({ ctx, input }) => {
      const dates = input.dates.map((d) => new Date(d));
      if (dates.length === 0) return [];

      const minDate = new Date(Math.min(...dates.map((d) => d.getTime())));
      const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())));

      // Expand range by 1 day on each side to account for timezone differences
      minDate.setDate(minDate.getDate() - 1);
      maxDate.setDate(maxDate.getDate() + 1);

      const existingWorkouts = await db
        .select({ date: workout.date })
        .from(workout)
        .where(
          and(
            eq(workout.userId, ctx.session.user.id),
            gte(workout.date, minDate),
            lte(workout.date, maxDate),
          ),
        );

      return existingWorkouts.map((w) => w.date.toISOString());
    }),

  /**
   * Step 3: Commit the import.
   * Input: parsed workouts + exercise resolution map
   * Output: { importedCount, skippedCount, createdExerciseCount }
   */
  commit: protectedProcedure
    .input(
      z.object({
        workouts: z.array(
          z.object({
            date: z.string(), // ISO date string
            workoutType: z.enum([
              "weightlifting",
              "hiit",
              "cardio",
              "calisthenics",
              "yoga",
              "sports",
              "mixed",
            ]),
            notes: z.string().optional(),
            exercises: z.array(
              z.object({
                name: z.string(),
                sets: z.array(
                  z.object({
                    setNumber: z.number(),
                    reps: z.number().optional(),
                    weight: z.number().optional(),
                    rpe: z.number().optional(),
                    durationSeconds: z.number().optional(),
                  }),
                ),
                notes: z.string().optional(),
                isSkipped: z.boolean(),
                rounds: z.number().optional(),
                workDurationSeconds: z.number().optional(),
                restDurationSeconds: z.number().optional(),
              }),
            ),
          }),
        ),
        resolutionMap: z.record(
          z.string(),
          z.union([
            // Mapped to existing exercise
            z.object({
              type: z.literal("existing"),
              exerciseId: z.string().uuid(),
            }),
            // Create new exercise during import
            z.object({
              type: z.literal("create"),
              name: z.string().min(1),
              category: z.enum([
                "chest",
                "back",
                "shoulders",
                "arms",
                "legs",
                "core",
                "cardio",
                "other",
              ]),
              exerciseType: z.enum([
                "weightlifting",
                "hiit",
                "cardio",
                "calisthenics",
                "yoga",
                "sports",
                "mixed",
              ]),
            }),
            // Skip this exercise (don't import it)
            z.object({
              type: z.literal("skip"),
            }),
          ]),
        ),
        skipDuplicateDates: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // --- Phase A: Create any new exercises (outside the main transaction) ---
      const createdExerciseMap: Record<string, string> = {}; // parsedName -> new exerciseId
      for (const [parsedName, resolution] of Object.entries(input.resolutionMap)) {
        if (resolution.type === "create") {
          const id = crypto.randomUUID();
          await db.insert(exercise).values({
            id,
            name: resolution.name,
            category: resolution.category,
            exerciseType: resolution.exerciseType,
            isCustom: true,
            createdByUserId: userId,
            status: null, // auto-approved -- skip the review queue
          });
          createdExerciseMap[parsedName] = id;
        }
      }

      // --- Phase B: Build the exerciseId lookup ---
      const exerciseIdForName = (parsedName: string): string | null => {
        const resolution = input.resolutionMap[parsedName];
        if (!resolution || resolution.type === "skip") return null;
        if (resolution.type === "existing") return resolution.exerciseId;
        return createdExerciseMap[parsedName] ?? null;
      };

      // --- Phase C: Filter workouts ---
      let workoutsToImport = input.workouts.filter((w) => {
        // Keep workouts that have at least one non-skipped, non-"skip"-resolution exercise
        const nonSkippedExercises = w.exercises.filter((ex) => {
          if (ex.isSkipped) return false;
          const resolution = input.resolutionMap[ex.name];
          return resolution && resolution.type !== "skip";
        });
        return nonSkippedExercises.length > 0;
      });

      // Handle duplicate dates if requested
      if (input.skipDuplicateDates) {
        const existingDates = new Set(
          (
            await db
              .select({ date: workout.date })
              .from(workout)
              .where(eq(workout.userId, userId))
          ).map((w) => w.date.toISOString().slice(0, 10)),
        );
        workoutsToImport = workoutsToImport.filter((w) => {
          const dateKey = new Date(w.date).toISOString().slice(0, 10);
          return !existingDates.has(dateKey);
        });
      }

      // --- Phase D: Batch insert in a transaction ---
      let importedCount = 0;
      const allExerciseIds = new Set<string>();

      try {
        await db.transaction(async (tx) => {
          for (const w of workoutsToImport) {
            const workoutId = crypto.randomUUID();

            const nonSkippedExercises = w.exercises.filter((ex) => {
              if (ex.isSkipped) return false;
              const resolution = input.resolutionMap[ex.name];
              return resolution && resolution.type !== "skip";
            });

            // Calculate total volume for this workout
            let totalVolume = 0;
            for (const ex of nonSkippedExercises) {
              for (const set of ex.sets) {
                if (set.durationSeconds !== undefined && set.reps === undefined) {
                  totalVolume += set.durationSeconds;
                } else {
                  totalVolume += (set.reps ?? 0) * (set.weight ?? 0);
                }
              }
            }

            await tx.insert(workout).values({
              id: workoutId,
              userId,
              date: new Date(w.date),
              workoutType: w.workoutType,
              notes: w.notes ?? null,
              totalVolume: totalVolume > 0 ? totalVolume : null,
            });

            for (let i = 0; i < nonSkippedExercises.length; i++) {
              const ex = nonSkippedExercises[i]!;
              const exId = exerciseIdForName(ex.name);
              if (exId) allExerciseIds.add(exId);

              const logId = crypto.randomUUID();
              await tx.insert(exerciseLog).values({
                id: logId,
                workoutId,
                exerciseId: exId ?? undefined,
                exerciseName: ex.name,
                order: i,
                rounds: ex.rounds ?? null,
                workDurationSeconds: ex.workDurationSeconds ?? null,
                restDurationSeconds: ex.restDurationSeconds ?? null,
                notes: ex.notes ?? null,
              });

              if (ex.sets.length > 0) {
                await tx.insert(exerciseSet).values(
                  ex.sets.map((s) => ({
                    id: crypto.randomUUID(),
                    exerciseLogId: logId,
                    setNumber: s.setNumber,
                    reps: s.reps ?? null,
                    weight: s.weight ?? null,
                    rpe: s.rpe ?? null,
                    durationSeconds: s.durationSeconds ?? null,
                  })),
                );
              }
            }

            importedCount++;
          }
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unknown database error";
        throw new Error(`Import failed: ${message}`);
      }

      // --- Phase E: Fire-and-forget recalculations ---
      const exerciseIds = Array.from(allExerciseIds);
      if (exerciseIds.length > 0) {
        recalculateProgressiveOverload(userId, exerciseIds).catch((err) =>
          console.error("Import: progressive overload recalc failed:", err),
        );
      }

      // Recalculate muscle group volume for each unique week
      const uniqueWeekStarts = new Set(
        workoutsToImport.map((w) => {
          const d = new Date(w.date);
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
            console.error("Import: muscle group volume recalc failed:", err),
        );
      }

      return {
        importedCount,
        skippedCount: input.workouts.length - importedCount,
        createdExerciseCount: Object.keys(createdExerciseMap).length,
      };
    }),
});
