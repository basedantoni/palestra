/**
 * Integration tests: Phase 1 — Whoop Run Linking
 *
 * Covers:
 * - whoop.listUnlinkedCardioActivities: filters to cardio/hiit, excludes already-linked, ±3-day window
 * - whoop.linkToWorkout: writes DTO fields, sets whoopActivityId, returns metricConflict
 * - whoop.linkToWorkout: unique constraint collision (same Whoop activity → two workouts)
 * - whoop.unlinkFromWorkout: clears whoopActivityId and nulls Whoop metrics
 * - whoop.unlinkFromWorkout: no-op on unlinked workouts
 * - whoopActivityToExerciseLog DTO: returns null metrics when score_state !== 'SCORED'
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ────────────────────────────────────────────────────────────────────────────
// Hoisted mocks (must run before any imports)
// ────────────────────────────────────────────────────────────────────────────
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
  enqueueRecalcs: vi.fn().mockResolvedValue(undefined),
}));

// Mock the Whoop client helper
vi.mock("../lib/whoop-client", () => ({
  WHOOP_API_BASE: "https://api.prod.whoop.com/developer/v1",
  getValidWhoopAccessToken: vi.fn().mockResolvedValue("mock-access-token"),
  resolveWhoopExerciseId: vi.fn().mockResolvedValue(null),
}));

import { exerciseLog, workout } from "@life-tracker/db/schema/index";

import { appRouter } from "../routers/index";
import { mockDb } from "./helpers/mock-db";
import { whoopActivityToExerciseLog } from "@life-tracker/shared";

// ────────────────────────────────────────────────────────────────────────────
// Test constants
// ────────────────────────────────────────────────────────────────────────────
const USER_ID = "00000000-0000-4000-8000-000000000101";
const WORKOUT_ID = "00000000-0000-4000-8000-000000000102";
const WORKOUT_ID_2 = "00000000-0000-4000-8000-000000000106";
const LOG_ID = "00000000-0000-4000-8000-000000000103";
const WHOOP_ACTIVITY_ID = "whoop-activity-abc123";

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

// ────────────────────────────────────────────────────────────────────────────
// Sample Whoop API responses
// ────────────────────────────────────────────────────────────────────────────
const RUNNING_ACTIVITY = {
  id: WHOOP_ACTIVITY_ID,
  start: "2026-04-28T06:00:00.000Z",
  end: "2026-04-28T07:00:00.000Z",
  sport_id: 1,
  sport_name: "running",
  score_state: "SCORED",
  score: {
    strain: 14.7,
    average_heart_rate: 155,
    max_heart_rate: 178,
    distance_meter: 10000,
    zone_durations: {
      zone_zero_milli: 120000,
      zone_one_milli: 300000,
      zone_two_milli: 600000,
      zone_three_milli: 1200000,
      zone_four_milli: 1200000,
      zone_five_milli: 180000,
    },
  },
};

const WEIGHTLIFTING_ACTIVITY = {
  id: "whoop-activity-weights",
  start: "2026-04-28T08:00:00.000Z",
  end: "2026-04-28T09:00:00.000Z",
  sport_id: 0,
  sport_name: "weightlifting",
  score_state: "SCORED",
  score: {
    strain: 8.2,
    average_heart_rate: 120,
    max_heart_rate: 145,
  },
};

const UNSCORED_RUNNING_ACTIVITY = {
  id: "whoop-activity-unscored",
  start: "2026-04-28T10:00:00.000Z",
  end: "2026-04-28T10:45:00.000Z",
  sport_id: 1,
  sport_name: "running",
  score_state: "PENDING_SCORE",
  score: null,
};

// ────────────────────────────────────────────────────────────────────────────
// Helper
// ────────────────────────────────────────────────────────────────────────────
/** The .set() of the (single) exercise_log / workout update. */
const logSet = () => mockDb.updated(exerciseLog)[0]!.set as Record<string, unknown>;
const workoutSet = () => mockDb.updated(workout)[0]!.set as Record<string, unknown>;

function mockFetch(responseBody: unknown, ok = true, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    text: () => Promise.resolve(JSON.stringify(responseBody)),
    json: () => Promise.resolve(responseBody),
  } as unknown as Response);
}

// ────────────────────────────────────────────────────────────────────────────
// Tests: whoopActivityToExerciseLog DTO (pure function — no mocks needed)
// ────────────────────────────────────────────────────────────────────────────
describe("whoopActivityToExerciseLog DTO", () => {
  it("maps scored activity to exercise log patch with correct intensity", () => {
    const patch = whoopActivityToExerciseLog(RUNNING_ACTIVITY);

    // strain=14.7, intensity = round(min(14.7,21)/21*100) = round(70) = 70
    expect(patch.intensity).toBe(70);
    expect(patch.heartRate).toBe(155);
    expect(patch.distanceMeter).toBe(10000);
    expect(patch.durationMinutes).toBe(60); // 1 hour
    expect(patch.hrZoneDurations).toEqual({
      zone_zero_milli: 120000,
      zone_one_milli: 300000,
      zone_two_milli: 600000,
      zone_three_milli: 1200000,
      zone_four_milli: 1200000,
      zone_five_milli: 180000,
    });
  });

  it("caps strain at 21 for intensity calculation", () => {
    const activity = {
      ...RUNNING_ACTIVITY,
      score: { ...RUNNING_ACTIVITY.score, strain: 25 },
    };
    const patch = whoopActivityToExerciseLog(activity);
    // strain=25 → min(25,21)=21 → round(21/21*100)=100
    expect(patch.intensity).toBe(100);
  });

  it("returns null metrics (not error) when score_state !== SCORED", () => {
    const patch = whoopActivityToExerciseLog(UNSCORED_RUNNING_ACTIVITY);

    expect(patch.distanceMeter).toBeNull();
    expect(patch.heartRate).toBeNull();
    expect(patch.intensity).toBeNull();
    expect(patch.hrZoneDurations).toBeNull();
    // durationMinutes is always derived from timestamps
    expect(patch.durationMinutes).toBe(45);
  });

  it("returns null hrZoneDurations when score has no zone_durations", () => {
    const activity = {
      ...RUNNING_ACTIVITY,
      score: { strain: 10, average_heart_rate: 140 },
    };
    const patch = whoopActivityToExerciseLog(activity as any);
    expect(patch.hrZoneDurations).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Tests: whoop.listUnlinkedCardioActivities
// ────────────────────────────────────────────────────────────────────────────
describe("whoop.listUnlinkedCardioActivities", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns only cardio/hiit activities, filtered from non-cardio types", async () => {
    // Whoop returns running + weightlifting
    mockFetch({
      records: [RUNNING_ACTIVITY, WEIGHTLIFTING_ACTIVITY],
      next_token: null,
    });

    // No linked activities: nothing queued

    const result = await userCaller.whoop.listUnlinkedCardioActivities({
      date: "2026-04-28",
    });

    expect(result.activities).toHaveLength(1);
    expect(result.activities[0]!.id).toBe(WHOOP_ACTIVITY_ID);
    expect(result.activities[0]!.sportName).toBe("running");
    expect(result.nextToken).toBeNull();
  });

  it("annotates already-linked activities with alreadyLinked: true", async () => {
    mockFetch({
      records: [RUNNING_ACTIVITY],
      next_token: null,
    });

    // The running activity is already linked
    mockDb.onSelect(workout, [
      { whoopActivityId: WHOOP_ACTIVITY_ID, id: "workout-123", date: new Date("2026-04-28") },
    ]);

    const result = await userCaller.whoop.listUnlinkedCardioActivities({
      date: "2026-04-28",
    });

    expect(result.activities).toHaveLength(1);
    expect(result.activities[0]!.alreadyLinked).toBe(true);
  });

  it("uses ±3 day window when constructing the API request", async () => {
    mockFetch({
      records: [],
      next_token: null,
    });

    await userCaller.whoop.listUnlinkedCardioActivities({
      date: "2026-04-28",
    });

    // Verify fetch was called with appropriate start/end params
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const fetchUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as string;
    expect(fetchUrl).toContain("start=2026-04-25");
    expect(fetchUrl).toContain("end=2026-05-01");
  });

  it("passes nextToken to Whoop API when provided", async () => {
    mockFetch({ records: [], next_token: null });

    await userCaller.whoop.listUnlinkedCardioActivities({
      date: "2026-04-28",
      nextToken: "cursor-abc",
    });

    const fetchUrl = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as string;
    expect(fetchUrl).toContain("nextToken=cursor-abc");
  });

  it("returns the next_token from Whoop API", async () => {
    mockFetch({
      records: [RUNNING_ACTIVITY],
      next_token: "next-page-token",
    });

    const result = await userCaller.whoop.listUnlinkedCardioActivities({
      date: "2026-04-28",
    });

    expect(result.nextToken).toBe("next-page-token");
  });

  it("returns correct activity shape", async () => {
    mockFetch({ records: [RUNNING_ACTIVITY], next_token: null });

    const result = await userCaller.whoop.listUnlinkedCardioActivities({
      date: "2026-04-28",
    });

    const activity = result.activities[0];
    expect(activity).toMatchObject({
      id: WHOOP_ACTIVITY_ID,
      start: "2026-04-28T06:00:00.000Z",
      end: "2026-04-28T07:00:00.000Z",
      sportName: "running",
      durationMinutes: 60,
      strain: 14.7,
      averageHeartRate: 155,
      distanceMeter: 10000,
      alreadyLinked: false,
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Tests: whoop.linkToWorkout
// ────────────────────────────────────────────────────────────────────────────
describe("whoop.linkToWorkout", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("writes all DTO fields to the exercise log and sets whoopActivityId", async () => {
    // Workout lookup → found, not linked; exercise log → no existing metrics
    mockDb.onSelect(workout, [{ id: WORKOUT_ID, whoopActivityId: null }]);
    mockDb.onSelect(exerciseLog, [{ id: LOG_ID, heartRate: null, intensity: null }]);

    // Whoop activity detail fetch
    mockFetch(RUNNING_ACTIVITY);


    const result = await userCaller.whoop.linkToWorkout({
      workoutId: WORKOUT_ID,
      whoopActivityId: WHOOP_ACTIVITY_ID,
      force: false,
    });

    expect(result).toEqual({ success: true, metricConflict: false });

    // Exercise log fields
    expect(logSet()).toMatchObject({
      heartRate: 155,
      intensity: 70,
      distanceMeter: 10000,
      durationMinutes: 60,
    });
    expect(logSet().hrZoneDurations).toBeDefined();

    // workout.whoopActivityId
    expect(workoutSet()).toEqual({ whoopActivityId: WHOOP_ACTIVITY_ID });
  });

  it("returns metricConflict: true when exercise log has existing metrics and force is false", async () => {
    mockDb.onSelect(workout, [{ id: WORKOUT_ID, whoopActivityId: null }]);
    // Exercise log with existing metrics
    mockDb.onSelect(exerciseLog, [{ id: LOG_ID, heartRate: 140, intensity: 55 }]);

    mockFetch(RUNNING_ACTIVITY);

    const result = await userCaller.whoop.linkToWorkout({
      workoutId: WORKOUT_ID,
      whoopActivityId: WHOOP_ACTIVITY_ID,
      force: false,
    });

    expect(result).toEqual({ success: false, metricConflict: true });

    // Transaction should NOT have been called
    expect(mockDb.db.transaction).not.toHaveBeenCalled();
  });

  it("overwrites existing metrics when force is true", async () => {
    mockDb.onSelect(workout, [{ id: WORKOUT_ID, whoopActivityId: null }]);
    mockDb.onSelect(exerciseLog, [{ id: LOG_ID, heartRate: 140, intensity: 55 }]);

    mockFetch(RUNNING_ACTIVITY);


    const result = await userCaller.whoop.linkToWorkout({
      workoutId: WORKOUT_ID,
      whoopActivityId: WHOOP_ACTIVITY_ID,
      force: true,
    });

    expect(result).toEqual({ success: true, metricConflict: false });
    expect(logSet()).toMatchObject({ heartRate: 155, intensity: 70 });
  });

  it("throws CONFLICT when same Whoop activity is linked to two workouts (unique constraint)", async () => {
    mockDb.onSelect(workout, [{ id: WORKOUT_ID_2, whoopActivityId: null }]);
    mockDb.onSelect(exerciseLog, [{ id: LOG_ID, heartRate: null, intensity: null }]);

    mockFetch(RUNNING_ACTIVITY);

    // Simulate unique constraint violation from Postgres
    const pgConstraintError = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "workout_userId_whoopActivityId_unique_idx"',
      ),
      {
        code: "23505",
        constraint: "workout_userId_whoopActivityId_unique_idx",
      },
    );
    mockDb.db.transaction.mockRejectedValueOnce(pgConstraintError);

    await expect(
      userCaller.whoop.linkToWorkout({
        workoutId: WORKOUT_ID_2,
        whoopActivityId: WHOOP_ACTIVITY_ID,
        force: false,
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("throws NOT_FOUND when workout does not belong to user", async () => {
    // Nothing queued: the workout lookup finds nothing.
    await expect(
      userCaller.whoop.linkToWorkout({
        workoutId: WORKOUT_ID,
        whoopActivityId: WHOOP_ACTIVITY_ID,
        force: false,
      }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("writes null metrics when score_state !== SCORED", async () => {
    mockDb.onSelect(workout, [{ id: WORKOUT_ID, whoopActivityId: null }]);
    mockDb.onSelect(exerciseLog, [{ id: LOG_ID, heartRate: null, intensity: null }]);

    mockFetch(UNSCORED_RUNNING_ACTIVITY);


    const result = await userCaller.whoop.linkToWorkout({
      workoutId: WORKOUT_ID,
      whoopActivityId: UNSCORED_RUNNING_ACTIVITY.id,
      force: false,
    });

    expect(result).toEqual({ success: true, metricConflict: false });

    // Metrics should be null (DTO returns null for unscored activities)
    expect(logSet()).toMatchObject({
      heartRate: null,
      intensity: null,
      distanceMeter: null,
      hrZoneDurations: null,
    });
    // durationMinutes is always derived from timestamps
    expect(logSet().durationMinutes).toBe(45);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Tests: whoop.unlinkFromWorkout
// ────────────────────────────────────────────────────────────────────────────
describe("whoop.unlinkFromWorkout", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("clears whoopActivityId and nulls Whoop metrics on the exercise log", async () => {
    mockDb.onSelect(workout, [{ id: WORKOUT_ID, whoopActivityId: WHOOP_ACTIVITY_ID }]);
    mockDb.onSelect(exerciseLog, [{ id: LOG_ID }]);


    const result = await userCaller.whoop.unlinkFromWorkout({
      workoutId: WORKOUT_ID,
    });

    expect(result).toEqual({ success: true });

    // Null out Whoop fields on the exercise log
    expect(logSet()).toEqual({
      heartRate: null,
      intensity: null,
      distanceMeter: null,
      durationMinutes: null,
      hrZoneDurations: null,
    });

    // Clear whoopActivityId on the workout
    expect(workoutSet()).toEqual({ whoopActivityId: null });
  });

  it("is a no-op when workout has no whoopActivityId", async () => {
    mockDb.onSelect(workout, [{ id: WORKOUT_ID, whoopActivityId: null }]);

    const result = await userCaller.whoop.unlinkFromWorkout({
      workoutId: WORKOUT_ID,
    });

    expect(result).toEqual({ success: true });
    // No transaction should be executed
    expect(mockDb.db.transaction).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when workout does not belong to user", async () => {
    // Nothing queued: the workout lookup finds nothing.
    await expect(
      userCaller.whoop.unlinkFromWorkout({ workoutId: WORKOUT_ID }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
