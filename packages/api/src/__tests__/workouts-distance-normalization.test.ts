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

const {
  mockDb,
  mockTx,
  makeChain,
  recalculateProgressiveOverload,
  recalculateMuscleGroupVolumeForWeek,
} = vi.hoisted(() => {
  function makeChain(
    resolveWith: unknown = [],
    onValues?: (value: unknown) => void,
  ) {
    const proxy: any = new Proxy(
      {},
      {
        get(_, prop: string) {
          if (prop === "values") {
            return vi.fn((value: unknown) => {
              onValues?.(value);
              return proxy;
            });
          }
          if (prop === "then") {
            return (ok: any) => Promise.resolve(resolveWith).then(ok);
          }
          if (prop === "catch") {
            return (err: any) => Promise.resolve(resolveWith).catch(err);
          }
          if (prop === "finally") {
            return (fin: any) => Promise.resolve(resolveWith).finally(fin);
          }
          return vi.fn(() => proxy);
        },
      },
    );

    return proxy;
  }

  const mockTx = {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };

  const mockDb = {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    select: vi.fn(),
    transaction: vi.fn(),
    query: {
      workout: {
        findFirst: vi.fn(),
      },
    },
  };

  const recalculateProgressiveOverload = vi.fn().mockResolvedValue(undefined);
  const recalculateMuscleGroupVolumeForWeek = vi
    .fn()
    .mockResolvedValue(undefined);

  return {
    mockDb,
    mockTx,
    makeChain,
    recalculateProgressiveOverload,
    recalculateMuscleGroupVolumeForWeek,
  };
});

vi.mock("@src/db", () => ({ db: mockDb }));

vi.mock("@src/env/server", () => ({
  env: {
    ADMIN_EMAILS: "admin@test.internal",
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test:test@localhost:5432/testdb",
    BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long!!",
    BETTER_AUTH_URL: "http://localhost:3000",
    CORS_ORIGIN: "http://localhost:3001",
  },
}));

vi.mock("../lib/progressive-overload-db", () => ({
  recalculateProgressiveOverload,
}));

vi.mock("../lib/muscle-group-volume-db", () => ({
  recalculateMuscleGroupVolumeForWeek,
}));

import { appRouter } from "../routers/index";

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

describe("distance normalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.transaction.mockImplementation(async (fn: any) => fn(mockTx));
  });

  it("accepts distanceMeter (not distance) in create input", async () => {
    const workoutDate = new Date("2026-04-27T12:00:00.000Z");

    mockDb.select
      .mockReturnValueOnce(makeChain([{ id: EXERCISE_ID, category: "cardio" }]))
      .mockReturnValueOnce(makeChain([]));

    mockTx.insert
      .mockReturnValueOnce(
        makeChain([
          {
            id: WORKOUT_ID,
            userId: USER_ID,
            date: workoutDate,
            workoutType: "cardio",
            durationMinutes: null,
            templateId: null,
            notes: null,
            totalVolume: null,
          },
        ]),
      )
      .mockReturnValueOnce(
        makeChain([
          {
            id: LOG_ID,
            workoutId: WORKOUT_ID,
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
          },
        ]),
      )
      .mockReturnValueOnce(makeChain([])); // PR insert for longest_distance

    const created = await userCaller.workouts.create({
      date: workoutDate,
      workoutType: "cardio",
      logs: [
        {
          exerciseId: EXERCISE_ID,
          exerciseName: "Long Run",
          order: 0,
          distanceMeter: FIVE_MILES_IN_METERS,
          durationSeconds: 2700,
        },
      ],
    });

    expect(created?.id).toBe(WORKOUT_ID);
  });

  it("stores distanceMeter value in insert, not distance", async () => {
    const workoutDate = new Date("2026-04-27T12:00:00.000Z");
    const capturedInserts: Array<Record<string, unknown>> = [];

    mockDb.select
      .mockReturnValueOnce(makeChain([{ id: EXERCISE_ID, category: "cardio" }]))
      .mockReturnValueOnce(makeChain([]));

    mockTx.insert.mockImplementation(() => ({
      values: vi.fn((val: unknown) => {
        capturedInserts.push(val as Record<string, unknown>);
        return {
          returning: vi.fn().mockResolvedValue([
            {
              id: LOG_ID,
              workoutId: WORKOUT_ID,
              exerciseId: EXERCISE_ID,
              exerciseName: "Long Run",
              order: 0,
              distanceMeter: FIVE_MILES_IN_METERS,
              durationSeconds: 2700,
            },
          ]),
        };
      }),
    }));

    // The first insert (workout) needs .returning() to return a workout row
    mockTx.insert
      .mockReturnValueOnce(
        makeChain([
          {
            id: WORKOUT_ID,
            userId: USER_ID,
            date: workoutDate,
            workoutType: "cardio",
          },
        ]),
      )
      .mockReturnValueOnce({
        values: vi.fn((val: unknown) => {
          capturedInserts.push(val as Record<string, unknown>);
          return makeChain([
            {
              id: LOG_ID,
              workoutId: WORKOUT_ID,
              exerciseId: EXERCISE_ID,
              exerciseName: "Long Run",
              order: 0,
              distanceMeter: FIVE_MILES_IN_METERS,
              durationSeconds: 2700,
            },
          ]);
        }),
      })
      .mockReturnValueOnce(makeChain([])); // PR insert

    await userCaller.workouts.create({
      date: workoutDate,
      workoutType: "cardio",
      logs: [
        {
          exerciseId: EXERCISE_ID,
          exerciseName: "Long Run",
          order: 0,
          distanceMeter: FIVE_MILES_IN_METERS,
          durationSeconds: 2700,
        },
      ],
    });

    // The exercise log insert should contain distanceMeter, not distance
    const logInsert = capturedInserts.find(
      (v) => typeof v === "object" && v !== null && "exerciseName" in v,
    );
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
    const capturedLogInserts: Array<Record<string, unknown>> = [];

    mockDb.select
      .mockReturnValueOnce(makeChain([{ id: EXERCISE_ID, category: "cardio" }]))
      .mockReturnValueOnce(makeChain([]));

    mockTx.insert
      .mockReturnValueOnce(
        makeChain([
          {
            id: WORKOUT_ID,
            userId: USER_ID,
            date: workoutDate,
            workoutType: "cardio",
          },
        ]),
      )
      .mockReturnValueOnce({
        values: vi.fn((val: unknown) => {
          capturedLogInserts.push(val as Record<string, unknown>);
          return makeChain([
            {
              id: LOG_ID,
              workoutId: WORKOUT_ID,
              exerciseName: "Long Run",
              order: 0,
            },
          ]);
        }),
      })
      .mockReturnValueOnce(makeChain([]));

    await userCaller.workouts.create({
      date: workoutDate,
      workoutType: "cardio",
      logs: [
        {
          exerciseId: EXERCISE_ID,
          exerciseName: "Long Run",
          order: 0,
          distanceMeter: FIVE_MILES_IN_METERS,
          durationSeconds: 2700,
          // @ts-expect-error — `pace` is not in the input schema; TypeScript correctly rejects it
          pace: 5.5, // should be stripped / not reach DB
        },
      ],
    });

    const logInsert = capturedLogInserts[0];
    expect(logInsert).not.toHaveProperty("pace");
  });

  it("records longest_distance PR in meters", async () => {
    const workoutDate = new Date("2026-04-27T12:00:00.000Z");
    const insertedPrs: Array<Record<string, unknown>> = [];

    mockDb.select
      .mockReturnValueOnce(makeChain([{ id: EXERCISE_ID, category: "cardio" }]))
      .mockReturnValueOnce(makeChain([])); // no existing PRs

    mockTx.insert
      .mockReturnValueOnce(
        makeChain([
          {
            id: WORKOUT_ID,
            userId: USER_ID,
            date: workoutDate,
            workoutType: "cardio",
          },
        ]),
      )
      .mockReturnValueOnce(
        makeChain([
          {
            id: LOG_ID,
            workoutId: WORKOUT_ID,
            exerciseId: EXERCISE_ID,
            exerciseName: "Long Run",
            order: 0,
            distanceMeter: FIVE_MILES_IN_METERS,
            durationSeconds: 2700,
          },
        ]),
      )
      .mockReturnValueOnce(
        makeChain([], (value) => {
          insertedPrs.push(value as Record<string, unknown>);
        }),
      );

    await userCaller.workouts.create({
      date: workoutDate,
      workoutType: "cardio",
      logs: [
        {
          exerciseId: EXERCISE_ID,
          exerciseName: "Long Run",
          order: 0,
          distanceMeter: FIVE_MILES_IN_METERS,
          durationSeconds: 2700,
        },
      ],
    });

    // Only one PR should be inserted: longest_distance (in meters)
    // best_pace should NOT be inserted (pace is derived, not stored)
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

    mockDb.select
      .mockReturnValueOnce(makeChain([{ id: EXERCISE_ID, category: "cardio" }]))
      .mockReturnValueOnce(makeChain([]));

    mockTx.insert
      .mockReturnValueOnce(
        makeChain([
          {
            id: WORKOUT_ID,
            userId: USER_ID,
            date: workoutDate,
            workoutType: "cardio",
          },
        ]),
      )
      .mockReturnValueOnce(
        makeChain([
          {
            id: LOG_ID,
            workoutId: WORKOUT_ID,
            exerciseId: EXERCISE_ID,
            exerciseName: "Long Run",
            order: 0,
            distanceMeter: FIVE_MILES_IN_METERS,
            durationSeconds: 2700,
          },
        ]),
      )
      .mockReturnValueOnce(makeChain([])); // PR insert

    mockDb.query.workout.findFirst.mockResolvedValue({
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

    await userCaller.workouts.create({
      date: workoutDate,
      workoutType: "cardio",
      logs: [
        {
          exerciseId: EXERCISE_ID,
          exerciseName: "Long Run",
          order: 0,
          distanceMeter: FIVE_MILES_IN_METERS,
          durationSeconds: 2700,
        },
      ],
    });

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
