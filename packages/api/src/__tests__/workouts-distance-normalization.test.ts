/**
 * TDD: Distance normalization round-trip tests
 *
 * Tests that:
 * 1. `distanceMeter` (not `distance`) is accepted by the tRPC input schema
 * 2. `pace` is rejected by the input schema (column no longer exists)
 * 3. Distance round-trips correctly: write meters, read back meters
 * 4. `longest_distance` PR is recorded in meters
 * 5. `best_pace` PR is NOT inserted from `pace` input (pace is derived, not stored)
 */

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

const USER_ID = "00000000-0000-4000-8000-000000000031";
const WORKOUT_ID = "00000000-0000-4000-8000-000000000032";
const LOG_ID = "00000000-0000-4000-8000-000000000033";
const EXERCISE_ID = "00000000-0000-4000-8000-000000000034";

// 5 miles in meters
const FIVE_MILES_IN_METERS = 5 * 1609.344; // 8046.72

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

const LOG_INPUT = {
  exerciseId: EXERCISE_ID,
  exerciseName: "Long Run",
  order: 0,
  distanceMeter: FIVE_MILES_IN_METERS,
  durationSeconds: 2700,
};

/** A cardio create's reads and writes: the exercise lookup, then the workout and log inserts. */
function cardioCreateReturns(workoutDate: Date) {
  mockDb.onSelect(exercise, [{ id: EXERCISE_ID, category: "cardio" }]);
  mockDb.onInsert(workout, [{ id: WORKOUT_ID, userId: USER_ID, date: workoutDate, workoutType: "cardio" }]);
  mockDb.onInsert(exerciseLog, [{ id: LOG_ID, workoutId: WORKOUT_ID, ...LOG_INPUT }]);
}

describe("distance normalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts distanceMeter (not distance) in create input", async () => {
    const workoutDate = new Date("2026-04-27T12:00:00.000Z");
    cardioCreateReturns(workoutDate);

    const created = await userCaller.workouts.create({
      date: workoutDate,
      workoutType: "cardio",
      logs: [LOG_INPUT],
    });

    expect(created?.id).toBe(WORKOUT_ID);
  });

  it("stores distanceMeter value in insert, not distance", async () => {
    const workoutDate = new Date("2026-04-27T12:00:00.000Z");
    cardioCreateReturns(workoutDate);

    await userCaller.workouts.create({ date: workoutDate, workoutType: "cardio", logs: [LOG_INPUT] });

    // The exercise log insert should contain distanceMeter, not distance
    const [logInsert] = mockDb.inserted(exerciseLog);
    expect(logInsert).toBeDefined();
    expect(logInsert).toHaveProperty("distanceMeter", FIVE_MILES_IN_METERS);
    expect(logInsert).not.toHaveProperty("distance");
    expect(logInsert).not.toHaveProperty("pace");
  });

  it("does not accept pace in create input (pace is derived at display time)", async () => {
    // The tRPC input schema should reject `pace` as an unknown field (strict) or simply ignore it
    // Since zod strips unknown fields by default, passing `pace` should either be ignored
    // or cause a parse error. Either way, it must NOT reach the DB insert.
    const workoutDate = new Date("2026-04-27T12:00:00.000Z");
    cardioCreateReturns(workoutDate);

    await userCaller.workouts.create({
      date: workoutDate,
      workoutType: "cardio",
      logs: [
        {
          ...LOG_INPUT,
          // @ts-expect-error — `pace` is not in the input schema; TypeScript correctly rejects it
          pace: 5.5, // should be stripped / not reach DB
        },
      ],
    });

    const [logInsert] = mockDb.inserted(exerciseLog);
    expect(logInsert).not.toHaveProperty("pace");
  });

  it("records longest_distance PR in meters", async () => {
    const workoutDate = new Date("2026-04-27T12:00:00.000Z");
    cardioCreateReturns(workoutDate); // no existing PRs

    await userCaller.workouts.create({ date: workoutDate, workoutType: "cardio", logs: [LOG_INPUT] });

    // Only one PR should be inserted: longest_distance (in meters)
    // best_pace should NOT be inserted (pace is derived, not stored)
    const insertedPrs = mockDb.inserted(personalRecord);
    expect(insertedPrs).toHaveLength(1);
    expect(insertedPrs[0]).toMatchObject({
      recordType: "longest_distance",
      value: FIVE_MILES_IN_METERS,
      exerciseId: EXERCISE_ID,
      userId: USER_ID,
      workoutId: WORKOUT_ID,
    });
  });

  it("round-trips distanceMeter: write meters, read back meters", async () => {
    const workoutDate = new Date("2026-04-27T12:00:00.000Z");
    cardioCreateReturns(workoutDate);
    mockDb.onQuery("workout", "findFirst", {
      id: WORKOUT_ID,
      userId: USER_ID,
      date: workoutDate,
      workoutType: "cardio",
      durationMinutes: null,
      templateId: null,
      notes: null,
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
          intensity: null,
          distanceMeter: FIVE_MILES_IN_METERS,
          durationSeconds: 2700,
          heartRate: null,
          durationMinutes: null,
          notes: null,
          sets: [],
          exercise: { exerciseType: "cardio" },
        },
      ],
    });

    await userCaller.workouts.create({ date: workoutDate, workoutType: "cardio", logs: [LOG_INPUT] });

    const fetched = await userCaller.workouts.get({ id: WORKOUT_ID });

    expect(fetched?.logs).toHaveLength(1);
    expect(fetched?.logs[0]).toMatchObject({
      distanceMeter: FIVE_MILES_IN_METERS,
      durationSeconds: 2700,
    });
    // Confirm old fields are gone
    expect(fetched?.logs[0]).not.toHaveProperty("pace");
    expect(fetched?.logs[0]).not.toHaveProperty("distance");
  });
});
