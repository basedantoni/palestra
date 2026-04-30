import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@src/db";
import { exercise, exerciseLog, workout } from "@src/db/schema/index";

import { protectedProcedure, router } from "../index";
import {
  type ParsedTcxRun,
  fingerprintTcxRun,
} from "../lib/tcx-import";
import { recalculateMuscleGroupVolumeForWeek } from "../lib/muscle-group-volume-db";
import { recalculateProgressiveOverload } from "../lib/progressive-overload-db";

const DEFAULT_TCX_IMPORT_SOURCE = "nike_run_club";
const LONG_RUN_THRESHOLD_M = 8000;
const MAX_TCX_IMPORT_RUNS = 500;

interface RunningExerciseIds {
  shortRunId: string;
  longRunId: string;
}

type ValidatedTcxRun = ParsedTcxRun & {
  startedAtDate: Date;
  fingerprint: string;
};

const parsedTcxRunSchema = z.object({
  fileName: z.string().min(1).max(255),
  startedAt: z.string().min(1),
  durationSeconds: z.number().int().positive(),
  distanceMeter: z.number().positive(),
  calories: z.number().int().nonnegative().nullable(),
  avgHeartRate: z.number().int().positive().nullable(),
  maxHeartRate: z.number().int().positive().nullable(),
});

const tcxImportInputBaseSchema = z.object({
  source: z.string().trim().min(1).max(80).optional(),
  runs: z.array(parsedTcxRunSchema).max(MAX_TCX_IMPORT_RUNS),
});

const tcxCommitInputSchema = tcxImportInputBaseSchema.extend({
  selectedFingerprints: z.array(z.string().min(1)).optional(),
});

function normalizeSource(source: string | undefined): string {
  return source?.trim() || DEFAULT_TCX_IMPORT_SOURCE;
}

function exerciseNameForDistance(distanceMeter: number): "Short Run" | "Long Run" {
  return distanceMeter >= LONG_RUN_THRESHOLD_M ? "Long Run" : "Short Run";
}

function exerciseIdForDistance(
  distanceMeter: number,
  ids: RunningExerciseIds,
): string {
  return distanceMeter >= LONG_RUN_THRESHOLD_M ? ids.longRunId : ids.shortRunId;
}

function validateRun(run: ParsedTcxRun): ValidatedTcxRun | null {
  const startedAtDate = new Date(run.startedAt);
  if (Number.isNaN(startedAtDate.getTime())) {
    return null;
  }

  return {
    ...run,
    startedAtDate,
    fingerprint: fingerprintTcxRun(startedAtDate, run.distanceMeter),
  };
}

async function loadRunningExerciseIds(): Promise<RunningExerciseIds> {
  const rows = await db
    .select({ id: exercise.id, name: exercise.name })
    .from(exercise)
    .where(
      and(eq(exercise.cardioSubtype, "running"), eq(exercise.isCustom, false)),
    );

  const byName = new Map(rows.map((row) => [row.name, row.id]));
  const shortRunId = byName.get("Short Run");
  const longRunId = byName.get("Long Run");

  if (!shortRunId || !longRunId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Seed data missing 'Short Run' or 'Long Run'. Run database seed before importing TCX files.",
    });
  }

  return { shortRunId, longRunId };
}

async function buildDedupIndex(
  userId: string,
  source: string,
): Promise<Set<string>> {
  const existing = await db
    .select({ date: workout.date, distanceMeter: exerciseLog.distanceMeter })
    .from(workout)
    .innerJoin(exerciseLog, eq(exerciseLog.workoutId, workout.id))
    .where(and(eq(workout.userId, userId), eq(workout.source, source)));

  const fingerprints = new Set<string>();
  for (const row of existing) {
    if (row.date && row.distanceMeter != null) {
      fingerprints.add(fingerprintTcxRun(row.date, row.distanceMeter));
    }
  }

  return fingerprints;
}

function buildNotes(source: string, run: ParsedTcxRun): string {
  const noteParts = [`Imported from TCX (${source})`];
  if (run.calories != null) {
    noteParts.push(`Calories: ${run.calories}`);
  }
  if (run.maxHeartRate != null) {
    noteParts.push(`Max HR: ${run.maxHeartRate}`);
  }
  return noteParts.join(" | ");
}

function weekStartDate(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

export const tcxImportRouter = router({
  preview: protectedProcedure
    .input(tcxImportInputBaseSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const source = normalizeSource(input.source);

      await loadRunningExerciseIds();
      const existingFingerprints = await buildDedupIndex(userId, source);
      const seenFingerprints = new Set<string>();

      let skippedInvalidCount = 0;
      const runs = [];

      for (const run of input.runs) {
        const validated = validateRun(run);
        if (!validated) {
          skippedInvalidCount += 1;
          continue;
        }

        const duplicateInRequest = seenFingerprints.has(validated.fingerprint);
        const duplicateInDb = existingFingerprints.has(validated.fingerprint);
        const isDuplicate = duplicateInRequest || duplicateInDb;

        runs.push({
          ...run,
          fingerprint: validated.fingerprint,
          isDuplicate,
          exerciseName: exerciseNameForDistance(run.distanceMeter),
        });

        seenFingerprints.add(validated.fingerprint);
      }

      const duplicateCount = runs.filter((run) => run.isDuplicate).length;

      return {
        source,
        totalCount: input.runs.length,
        duplicateCount,
        newCount: runs.length - duplicateCount,
        skippedInvalidCount,
        runs,
      };
    }),

  commit: protectedProcedure
    .input(tcxCommitInputSchema)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const source = normalizeSource(input.source);
      const selectedFingerprints = input.selectedFingerprints
        ? new Set(input.selectedFingerprints)
        : null;

      const exerciseIds = await loadRunningExerciseIds();
      const existingFingerprints = await buildDedupIndex(userId, source);
      const seenFingerprints = new Set<string>();
      const runsToImport: ValidatedTcxRun[] = [];
      let skippedInvalidCount = 0;
      let skippedDuplicateCount = 0;

      for (const run of input.runs) {
        const validated = validateRun(run);
        if (!validated) {
          skippedInvalidCount += 1;
          continue;
        }

        if (
          selectedFingerprints != null &&
          !selectedFingerprints.has(validated.fingerprint)
        ) {
          continue;
        }

        if (
          seenFingerprints.has(validated.fingerprint) ||
          existingFingerprints.has(validated.fingerprint)
        ) {
          skippedDuplicateCount += 1;
          continue;
        }

        runsToImport.push(validated);
        seenFingerprints.add(validated.fingerprint);
      }

      const importedExerciseIds = new Set<string>();
      const insertedWorkoutDates: Date[] = [];

      if (runsToImport.length > 0) {
        await db.transaction(async (tx) => {
          for (const run of runsToImport) {
            const workoutId = crypto.randomUUID();
            const exerciseId = exerciseIdForDistance(
              run.distanceMeter,
              exerciseIds,
            );
            const exerciseName = exerciseNameForDistance(run.distanceMeter);
            const durationMinutes = Math.max(
              1,
              Math.round(run.durationSeconds / 60),
            );

            await tx.insert(workout).values({
              id: workoutId,
              userId,
              date: run.startedAtDate,
              workoutType: "cardio",
              durationMinutes,
              notes: buildNotes(source, run),
              source,
            });

            await tx.insert(exerciseLog).values({
              id: crypto.randomUUID(),
              workoutId,
              exerciseId,
              exerciseName,
              order: 0,
              distanceMeter: run.distanceMeter,
              durationSeconds: run.durationSeconds,
              durationMinutes,
              heartRate: run.avgHeartRate ?? null,
            });

            importedExerciseIds.add(exerciseId);
            insertedWorkoutDates.push(run.startedAtDate);
          }
        });
      }

      const exerciseIdList = Array.from(importedExerciseIds);
      if (exerciseIdList.length > 0) {
        recalculateProgressiveOverload(userId, exerciseIdList).catch((err) =>
          console.error("TCX import: progressive overload recalc failed:", err),
        );
      }

      const uniqueWeekStarts = new Set(
        insertedWorkoutDates.map((date) =>
          weekStartDate(date).toISOString().slice(0, 10),
        ),
      );

      for (const weekStart of uniqueWeekStarts) {
        recalculateMuscleGroupVolumeForWeek(userId, new Date(weekStart)).catch(
          (err) =>
            console.error(
              "TCX import: muscle group volume recalc failed:",
              err,
            ),
        );
      }

      return {
        createdCount: runsToImport.length,
        skippedDuplicateCount,
        skippedInvalidCount,
        totalCount:
          selectedFingerprints == null ? input.runs.length : selectedFingerprints.size,
      };
    }),
});
