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
import { mockDb } from "./helpers/mock-db";

const USER_ID = "00000000-0000-4000-8000-000000000021";
const WORKOUT_ID = "00000000-0000-4000-8000-000000000022";
const LOG_ID = "00000000-0000-4000-8000-000000000023";
const EXERCISE_ID = "00000000-0000-4000-8000-000000000024";

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

describe("workouts cardio round-trip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a cardio workout via tRPC and fetches the same cardio fields back", async () => {
    const workoutDate = new Date("2026-04-23T12:00:00.000Z");

    mockDb.onSelect(exercise, [{ id: EXERCISE_ID, category: "cardio" }]);

    // 8.2 miles converted to meters (as if the client sends meters)
    const distanceInMeters = 8.2 * 1609.344;

    mockDb.onInsert(workout, [
      {
        id: WORKOUT_ID,
        userId: USER_ID,
        date: workoutDate,
        workoutType: "cardio",
        durationMinutes: null,
        templateId: null,
        notes: "Track block",
        totalVolume: null,
      },
    ]);
    mockDb.onInsert(exerciseLog, [
      {
        id: LOG_ID,
        workoutId: WORKOUT_ID,
        exerciseId: EXERCISE_ID,
        exerciseName: "Long Run",
        order: 0,
        rounds: null,
        workDurationSeconds: null,
        restDurationSeconds: null,
        intensity: 7,
        distanceMeter: distanceInMeters,
        durationSeconds: 2700,
        heartRate: 148,
        durationMinutes: null,
        notes: "Steady effort",
      },
    ]);

    mockDb.onQuery("workout", "findFirst", {
      id: WORKOUT_ID,
      userId: USER_ID,
      date: workoutDate,
      workoutType: "cardio",
      durationMinutes: null,
      templateId: null,
      notes: "Track block",
      totalVolume: null,
      logs: [
        {
          id: LOG_ID,
          exerciseId: EXERCISE_ID,
          exerciseName: "Long Run",
          order: 0,
          rounds: null,
          workDurationSeconds: null,
          restDurationSeconds: null,
          intensity: 7,
          distanceMeter: distanceInMeters,
          durationSeconds: 2700,
          heartRate: 148,
          durationMinutes: null,
          notes: "Steady effort",
          sets: [],
          exercise: {
            exerciseType: "cardio",
          },
        },
      ],
    });

    const created = await userCaller.workouts.create({
      date: workoutDate,
      workoutType: "cardio",
      notes: "Track block",
      logs: [
        {
          exerciseId: EXERCISE_ID,
          exerciseName: "Long Run",
          order: 0,
          intensity: 7,
          distanceMeter: distanceInMeters,
          durationSeconds: 2700,
          heartRate: 148,
          notes: "Steady effort",
        },
      ],
    });

    expect(created!.id).toBe(WORKOUT_ID);
    // 3 inserts: workout + exercise log + 1 PR (longest_distance only; best_pace is derived)
    expect(mockDb.opsOf("insert").map((op) => op.table)).toEqual([
      workout,
      exerciseLog,
      personalRecord,
    ]);
    expect(mockDb.inserted(personalRecord)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: USER_ID,
          exerciseId: EXERCISE_ID,
          recordType: "longest_distance",
          value: distanceInMeters,
          workoutId: WORKOUT_ID,
          previousRecordValue: null,
        }),
      ]),
    );

    const fetched = await userCaller.workouts.get({ id: WORKOUT_ID });

    expect(fetched?.logs).toHaveLength(1);
    expect(fetched?.logs[0]).toMatchObject({
      exerciseId: EXERCISE_ID,
      exerciseName: "Long Run",
      intensity: 7,
      distanceMeter: distanceInMeters,
      durationSeconds: 2700,
      heartRate: 148,
      notes: "Steady effort",
    });
    expect(fetched?.logs[0]?.sets).toEqual([]);
  });
});
