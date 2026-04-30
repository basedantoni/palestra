import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { db } from "@src/db";
import { exercise, exerciseLog, workout } from "@src/db/schema/index";
import { and, eq } from "drizzle-orm";
import {
  fingerprintTcxRun,
  parseTcxRun,
  type ParsedTcxRun,
} from "../packages/api/src/lib/tcx-import";

const NIKE_RUN_CLUB_SOURCE = "nike_run_club";
const LONG_RUN_THRESHOLD_M = 8000;

interface ParsedRun extends Omit<ParsedTcxRun, "startedAt"> {
  filePath: string;
  startedAt: Date;
}

interface RunningExerciseIds {
  shortRunId: string;
  longRunId: string;
}

interface ImportArgs {
  inputDir: string;
  userId: string | undefined;
  dryRun: boolean;
}

function parseArgs(): ImportArgs {
  const args = process.argv.slice(2);
  const get = (name: string) => {
    const i = args.findIndex((arg) => arg === name || arg.startsWith(`${name}=`));
    if (i < 0) {
      return undefined;
    }

    const eq = args[i].indexOf("=");
    if (eq >= 0) {
      return args[i].slice(eq + 1);
    }

    const value = args[i + 1];
    return value && !value.startsWith("--") ? value : undefined;
  };

  return {
    inputDir: get("--input") ?? `${process.env.HOME}/Downloads/nikeuserdata/tcx`,
    userId: get("--user-id"),
    dryRun: args.includes("--dry-run"),
  };
}

async function loadRunningExercises(): Promise<RunningExerciseIds> {
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
    throw new Error(
      "Seed data missing 'Short Run' or 'Long Run'. Run `pnpm db:seed` first.",
    );
  }

  return { shortRunId, longRunId };
}

async function buildDedupIndex(userId: string): Promise<Set<string>> {
  const existing = await db
    .select({ date: workout.date, distanceMeter: exerciseLog.distanceMeter })
    .from(workout)
    .innerJoin(exerciseLog, eq(exerciseLog.workoutId, workout.id))
    .where(
      and(eq(workout.userId, userId), eq(workout.source, NIKE_RUN_CLUB_SOURCE)),
    );

  const fingerprints = new Set<string>();
  for (const row of existing) {
    if (row.date && row.distanceMeter != null) {
      fingerprints.add(fingerprintTcxRun(row.date, row.distanceMeter));
    }
  }

  return fingerprints;
}

async function importRun(
  run: ParsedRun,
  userId: string,
  ids: RunningExerciseIds,
): Promise<{ workoutId: string }> {
  const isLongRun = run.distanceMeter >= LONG_RUN_THRESHOLD_M;
  const exerciseId = isLongRun ? ids.longRunId : ids.shortRunId;
  const exerciseName = isLongRun ? "Long Run" : "Short Run";
  const durationMinutes = Math.max(1, Math.round(run.durationSeconds / 60));

  const noteParts = ["Imported from Nike Run Club"];
  if (run.calories != null) {
    noteParts.push(`Calories: ${run.calories}`);
  }
  if (run.maxHeartRate != null) {
    noteParts.push(`Max HR: ${run.maxHeartRate}`);
  }

  return db.transaction(async (tx) => {
    const workoutId = randomUUID();

    await tx.insert(workout).values({
      id: workoutId,
      userId,
      date: run.startedAt,
      workoutType: "cardio",
      durationMinutes,
      notes: noteParts.join(" | "),
      source: NIKE_RUN_CLUB_SOURCE,
    });

    await tx.insert(exerciseLog).values({
      id: randomUUID(),
      workoutId,
      exerciseId,
      exerciseName,
      order: 0,
      distanceMeter: run.distanceMeter,
      durationSeconds: run.durationSeconds,
      durationMinutes,
      heartRate: run.avgHeartRate ?? undefined,
    });

    return { workoutId };
  });
}

function parseTcxFile(filePath: string): ParsedRun | null {
  const xml = readFileSync(filePath, "utf8");
  const parsed = parseTcxRun(filePath, xml);
  if (!parsed) return null;

  const startedAt = new Date(parsed.startedAt);
  if (Number.isNaN(startedAt.getTime())) {
    return null;
  }

  return {
    ...parsed,
    filePath,
    startedAt,
  };
}

async function main() {
  const { inputDir, userId, dryRun } = parseArgs();

  if (!userId) {
    console.error("Error: --user-id <id> is required");
    process.exit(1);
  }

  const dir = resolve(inputDir);
  if (!statSync(dir).isDirectory()) {
    console.error(`Error: ${dir} is not a directory`);
    process.exit(1);
  }

  const files = readdirSync(dir)
    .filter((fileName) => fileName.endsWith(".tcx"))
    .map((fileName) => join(dir, fileName))
    .sort();

  console.log(`Found ${files.length} .tcx files in ${dir}`);
  console.log(`Target userId: ${userId}${dryRun ? "  [DRY RUN]" : ""}`);

  const parsed: ParsedRun[] = [];
  let parseErrors = 0;

  for (const filePath of files) {
    try {
      const run = parseTcxFile(filePath);
      if (run) {
        parsed.push(run);
      } else {
        parseErrors += 1;
        console.warn(`  skipped (not a running activity): ${filePath}`);
      }
    } catch (err) {
      parseErrors += 1;
      console.warn(`  parse error: ${filePath}: ${(err as Error).message}`);
    }
  }

  console.log(`Parsed ${parsed.length}/${files.length} runs (errors: ${parseErrors})`);

  if (dryRun) {
    for (const run of parsed.slice(0, 5)) {
      console.log(
        `  ${run.startedAt.toISOString()}  ${(run.distanceMeter / 1000).toFixed(2)}km  ${(run.durationSeconds / 60).toFixed(1)}min  HR=${run.avgHeartRate ?? "-"}`,
      );
    }
  }

  const exerciseIds = await loadRunningExercises();
  const dedupIndex = await buildDedupIndex(userId);

  let imported = 0;
  let skippedDuplicate = 0;
  let skippedError = parseErrors;

  for (const run of parsed) {
    const runFingerprint = fingerprintTcxRun(run.startedAt, run.distanceMeter);
    if (dedupIndex.has(runFingerprint)) {
      skippedDuplicate += 1;
      console.warn(
        `  skipped duplicate ${run.startedAt.toISOString()} ${(run.distanceMeter / 1000).toFixed(2)}km ${run.filePath}`,
      );
      continue;
    }

    if (dryRun) {
      imported += 1;
      dedupIndex.add(runFingerprint);
      continue;
    }

    try {
      await importRun(run, userId, exerciseIds);
      imported += 1;
      dedupIndex.add(runFingerprint);
      console.log(
        `  imported ${run.startedAt.toISOString()} ${(run.distanceMeter / 1000).toFixed(2)}km`,
      );
    } catch (err) {
      skippedError += 1;
      console.warn(
        `  import error: ${run.filePath}: ${(err as Error).message}`,
      );
    }
  }

  console.log(
    `imported=${imported} skipped_duplicate=${skippedDuplicate} skipped_error=${skippedError} total_files=${files.length}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
