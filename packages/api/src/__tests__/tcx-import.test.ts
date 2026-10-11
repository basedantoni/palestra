import { beforeEach, describe, expect, it, vi } from "vitest";

const { enqueueRecalcs } = vi.hoisted(() => ({
  enqueueRecalcs: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@life-tracker/db", () => import("./helpers/mock-db").then((m) => m.mockDbModule));

vi.mock("@life-tracker/env/server", () => ({
  env: {
    ADMIN_EMAILS: "admin@test.internal",
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test:test@localhost:5432/testdb",
    BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long!!",
    BETTER_AUTH_URL: "http://localhost:3000",
    CORS_ORIGIN: "http://localhost:3001",
  },
}));

vi.mock("../lib/recalc-queue", () => ({
  enqueueRecalcs,
}));

import { exercise, exerciseLog, personalRecord, workout } from "@life-tracker/db/schema/index";

import { appRouter } from "../routers/index";
import { fingerprintTcxRun, type ParsedTcxRun } from "../lib/tcx-import";
import { mockDb } from "./helpers/mock-db";

const USER_ID = "00000000-0000-4000-8000-000000000301";
const SHORT_RUN_ID = "00000000-0000-4000-8000-000000000302";
const LONG_RUN_ID = "00000000-0000-4000-8000-000000000303";

const userCaller = appRouter.createCaller({
  session: {
    user: { id: USER_ID, email: "user@test.internal", name: "Test User" },
    session: {
      id: "sess-user",
      userId: USER_ID,
      expiresAt: new Date(Date.now() + 86400000),
    },
  },
  headers: new Headers(),
} as any);

const runningExerciseRows = [
  { id: SHORT_RUN_ID, name: "Short Run" },
  { id: LONG_RUN_ID, name: "Long Run" },
];

const shortRun: ParsedTcxRun = {
  fileName: "short.tcx",
  startedAt: "2026-01-01T12:00:00.000Z",
  durationSeconds: 1800,
  distanceMeter: 5000.4,
  calories: 300,
  avgHeartRate: 140,
  maxHeartRate: 170,
};

const longRun: ParsedTcxRun = {
  fileName: "long.tcx",
  startedAt: "2026-01-02T12:00:00.000Z",
  durationSeconds: 3600,
  distanceMeter: 10000,
  calories: 700,
  avgHeartRate: 150,
  maxHeartRate: 180,
};

const duplicateRun: ParsedTcxRun = {
  fileName: "duplicate-a.tcx",
  startedAt: "2022-10-29T19:05:05.526Z",
  durationSeconds: 6001,
  distanceMeter: 14920.372,
  calories: 1146,
  avgHeartRate: 147,
  maxHeartRate: 165,
};

const duplicateRunSameRequest: ParsedTcxRun = {
  ...duplicateRun,
  fileName: "duplicate-b.tcx",
  distanceMeter: 14924.9,
  calories: null,
};

describe("tcxImport router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // recordPr reads personal_record twice per record type (existing + prior
    // best); nothing queued means "no prior PRs", so both running PRs record.
  });

  /** The running-exercise lookup, then the duplicate check's matching workouts. */
  const existingWorkouts = (duplicates: unknown[] = []) => {
    mockDb.onSelect(exercise, runningExerciseRows);
    mockDb.onSelect(workout, duplicates);
  };

  /** Every insert's .values() payload (workout, log, PRs), in order. */
  const insertedValues = () =>
    mockDb.opsOf("insert").map((op) => op.arg("values"));

  const isLogInsert = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" &&
    v !== null &&
    "exerciseName" in v &&
    "distanceMeter" in v;

  const isPrInsert = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && "recordType" in v;

  it("previews DB duplicates and repeated files in the same request", async () => {
    existingWorkouts([
      {
        date: new Date(duplicateRun.startedAt),
        distanceMeter: duplicateRun.distanceMeter,
      },
    ]);

    const result = await userCaller.tcxImport.preview({
      runs: [shortRun, duplicateRun, duplicateRunSameRequest],
    });

    expect(result.source).toBe("nike_run_club");
    expect(result.totalCount).toBe(3);
    expect(result.duplicateCount).toBe(2);
    expect(result.newCount).toBe(1);
    expect(result.skippedInvalidCount).toBe(0);
    expect(result.runs).toEqual([
      expect.objectContaining({
        fileName: "short.tcx",
        isDuplicate: false,
        exerciseName: "Short Run",
      }),
      expect.objectContaining({
        fileName: "duplicate-a.tcx",
        isDuplicate: true,
        exerciseName: "Long Run",
      }),
      expect.objectContaining({
        fileName: "duplicate-b.tcx",
        isDuplicate: true,
        exerciseName: "Long Run",
      }),
    ]);
  });

  it("commits new TCX runs as cardio workouts and exercise logs", async () => {
    existingWorkouts();

    const result = await userCaller.tcxImport.commit({
      runs: [shortRun],
    });

    expect(result).toEqual({
      createdCount: 1,
      skippedDuplicateCount: 0,
      skippedInvalidCount: 0,
      totalCount: 1,
    });
    expect(mockDb.db.transaction).toHaveBeenCalledTimes(1);
    // workout + exercise log + 2 running PRs (longest_distance + best_pace)
    expect(mockDb.opsOf("insert").map((op) => op.table)).toEqual([
      workout,
      exerciseLog,
      personalRecord,
      personalRecord,
    ]);
    expect(insertedValues()[0]).toMatchObject({
      userId: USER_ID,
      date: new Date(shortRun.startedAt),
      workoutType: "cardio",
      durationMinutes: 30,
      source: "nike_run_club",
    });
    expect(insertedValues()[0]).toMatchObject({
      notes: expect.stringContaining("Imported from TCX (nike_run_club)"),
    });
    expect(insertedValues()[1]).toMatchObject({
      exerciseId: SHORT_RUN_ID,
      exerciseName: "Short Run",
      order: 0,
      distanceMeter: shortRun.distanceMeter,
      durationSeconds: shortRun.durationSeconds,
      durationMinutes: 30,
      heartRate: shortRun.avgHeartRate,
    });
    expect(enqueueRecalcs).toHaveBeenCalledWith(USER_ID, {
      exerciseIds: [SHORT_RUN_ID],
      weekDates: [new Date(shortRun.startedAt)],
    });
  });

  it("maps runs under 8km to Short Run and 8km or longer to Long Run", async () => {
    existingWorkouts();

    await userCaller.tcxImport.commit({
      runs: [shortRun, longRun],
    });

    const logInserts = insertedValues().filter(isLogInsert);
    expect(logInserts[0]).toMatchObject({
      exerciseId: SHORT_RUN_ID,
      exerciseName: "Short Run",
    });
    expect(logInserts[1]).toMatchObject({
      exerciseId: LONG_RUN_ID,
      exerciseName: "Long Run",
    });
  });

  it("skips already-imported TCX runs on rerun without opening a transaction", async () => {
    existingWorkouts([
      {
        date: new Date(shortRun.startedAt),
        distanceMeter: shortRun.distanceMeter,
      },
      {
        date: new Date(longRun.startedAt),
        distanceMeter: longRun.distanceMeter,
      },
    ]);

    const result = await userCaller.tcxImport.commit({
      runs: [shortRun, longRun],
    });

    expect(result).toEqual({
      createdCount: 0,
      skippedDuplicateCount: 2,
      skippedInvalidCount: 0,
      totalCount: 2,
    });
    expect(mockDb.db.transaction).not.toHaveBeenCalled();
    expect(insertedValues()).toEqual([]);
  });

  it("commits only selected fingerprints when provided", async () => {
    existingWorkouts();

    const result = await userCaller.tcxImport.commit({
      runs: [shortRun, longRun],
      selectedFingerprints: [
        fingerprintTcxRun(longRun.startedAt, longRun.distanceMeter),
      ],
    });

    expect(result.createdCount).toBe(1);
    expect(result.totalCount).toBe(1);
    expect(insertedValues()[1]).toMatchObject({
      exerciseId: LONG_RUN_ID,
      exerciseName: "Long Run",
    });
  });

  it("records longest_distance and best_pace PRs when a run beats prior best", async () => {
    existingWorkouts();
    // Nothing queued for personal_record → no prior PRs, so both running PRs record.

    await userCaller.tcxImport.commit({ runs: [shortRun] });

    const prInserts = insertedValues().filter(isPrInsert);
    const longestDistance = prInserts.find(
      (v) => v.recordType === "longest_distance",
    );
    const bestPace = prInserts.find((v) => v.recordType === "best_pace");

    expect(longestDistance).toMatchObject({
      userId: USER_ID,
      exerciseId: SHORT_RUN_ID,
      recordType: "longest_distance",
      value: shortRun.distanceMeter,
      previousRecordValue: null,
    });
    // best_pace = (durationMinutes * 60) / (distanceMeter / 1000) seconds per km
    expect(bestPace).toMatchObject({
      userId: USER_ID,
      exerciseId: SHORT_RUN_ID,
      recordType: "best_pace",
      previousRecordValue: null,
    });
    expect(bestPace?.value).toBeCloseTo(
      (30 * 60) / (shortRun.distanceMeter / 1000),
      5,
    );
  });

  it("does not record a PR when a run is shorter/slower than the existing best", async () => {
    existingWorkouts();
    // recordPr(longest_distance): existing [], prior best 999999 (unbeatable)
    // recordPr(best_pace): existing [], prior best 1 s/km (unbeatable, lower is better)
    mockDb.onSelect(personalRecord, [], [{ value: 999999 }], [], [{ value: 1 }]);

    const result = await userCaller.tcxImport.commit({ runs: [shortRun] });

    expect(result.createdCount).toBe(1);
    const prInserts = insertedValues().filter(isPrInsert);
    expect(prInserts).toHaveLength(0);
  });
});
