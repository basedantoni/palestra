/**
 * Integration tests: KOI-77 — whoop.commit sets exerciseId + distanceMeter + records PRs
 *
 * Covers the manual bulk-import path (whoop.commit):
 * - Exercise log rows get a real exerciseId (not null) for resolvable cardio.
 * - distanceMeter is populated for running activities (from the shared DTO).
 * - A personal_record row is inserted for running activities that beat prior best.
 * - Re-running the same import is idempotent (already-imported activities skipped).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ────────────────────────────────────────────────────────────────────────────
// Hoisted mocks (must run before any imports)
// ────────────────────────────────────────────────────────────────────────────
const {
  mockDb,
  mockTx,
  makeChain,
  recalculateProgressiveOverload,
  recalculateMuscleGroupVolumeForWeek,
  resolveWhoopExerciseId,
} = vi.hoisted(() => {
  /**
   * Drizzle-style chainable proxy. Resolves to `resolveWith` when awaited.
   * `.values(v)` invokes the optional `onValues` callback so inserts can be
   * captured, then continues the chain. All other props return the proxy.
   */
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
    select: vi.fn(),
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
  const resolveWhoopExerciseId = vi.fn();

  return {
    mockDb,
    mockTx,
    makeChain,
    recalculateProgressiveOverload,
    recalculateMuscleGroupVolumeForWeek,
    resolveWhoopExerciseId,
  };
});

vi.mock("@life-tracker/db", () => ({ db: mockDb }));

vi.mock("@life-tracker/env/server", () => ({
  env: {
    ADMIN_EMAILS: "admin@test.internal",
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test:test@localhost:5432/testdb",
    BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long!!",
    BETTER_AUTH_URL: "http://localhost:3000",
    CORS_ORIGIN: "http://localhost:3001",
    WHOOP_CLIENT_SECRET: "whoop-secret",
  },
}));

vi.mock("../lib/progressive-overload-db", () => ({
  recalculateProgressiveOverload,
}));

vi.mock("../lib/muscle-group-volume-db", () => ({
  recalculateMuscleGroupVolumeForWeek,
}));

// Mock the Whoop client: stub auth + exercise resolution, keep the real
// WHOOP_API_BASE so fetch URLs are well-formed.
vi.mock("../lib/whoop-client", () => ({
  WHOOP_API_BASE: "https://api.prod.whoop.com/developer/v2",
  getValidWhoopAccessToken: vi.fn().mockResolvedValue("mock-access-token"),
  resolveWhoopExerciseId,
}));

import { appRouter } from "../routers/index";

// ────────────────────────────────────────────────────────────────────────────
// Test constants
// ────────────────────────────────────────────────────────────────────────────
const USER_ID = "00000000-0000-4000-8000-000000000301";
const EXERCISE_ID = "00000000-0000-4000-8000-000000000302";
const WHOOP_ACTIVITY_ID = "whoop-activity-run-001";

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

// ────────────────────────────────────────────────────────────────────────────
// Helper: mock fetch for the per-activity detail endpoint
// ────────────────────────────────────────────────────────────────────────────
function mockFetch(responseBody: unknown, ok = true, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    text: () => Promise.resolve(JSON.stringify(responseBody)),
    json: () => Promise.resolve(responseBody),
  } as unknown as Response);
}

describe("whoop.commit — exerciseId + distanceMeter + PRs (KOI-77)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.transaction.mockImplementation(async (fn: any) => fn(mockTx));
    // recordPr calls tx.select to read prior-best / same-workout rows; default
    // to an empty result (no prior best → candidate becomes a new PR).
    mockTx.select.mockReturnValue(makeChain([]));
    mockTx.insert.mockReturnValue(makeChain([]));
    mockTx.update.mockReturnValue(makeChain([]));
    // resolveWhoopExerciseId resolves running → a real library exercise.
    resolveWhoopExerciseId.mockResolvedValue({
      id: EXERCISE_ID,
      name: "Long Run",
    });
  });

  it("sets exerciseId, distanceMeter and inserts a PR for a running import", async () => {
    // Step 1: fetch the single requested activity detail
    mockFetch(RUNNING_ACTIVITY);

    // Step 2: dedupe lookup (db.select) → no existing rows
    mockDb.select.mockReturnValueOnce(makeChain([]));

    // Capture every tx.insert payload
    const inserts: Array<{ table: unknown; value: Record<string, unknown> }> =
      [];
    mockTx.insert.mockImplementation((table: unknown) =>
      makeChain([], (value) => {
        inserts.push({ table, value: value as Record<string, unknown> });
      }),
    );

    const result = await userCaller.whoop.commit({
      activityIds: [WHOOP_ACTIVITY_ID],
    });

    expect(result).toEqual({ createdCount: 1, skippedCount: 0 });

    // resolveWhoopExerciseId called with sport + distance from the DTO
    expect(resolveWhoopExerciseId).toHaveBeenCalledWith(1, "running", 10000);

    // Exercise log insert carries a real exerciseId + distanceMeter (from DTO)
    const logInsert = inserts.find(
      (i) => i.value.workoutId !== undefined && i.value.order === 0,
    );
    expect(logInsert).toBeDefined();
    expect(logInsert!.value.exerciseId).toBe(EXERCISE_ID);
    expect(logInsert!.value.exerciseName).toBe("Long Run");
    expect(logInsert!.value.distanceMeter).toBe(10000);
    expect(logInsert!.value.heartRate).toBe(155);
    // intensity = round(min(14.7,21)/21*100) = 70 (shared DTO normalization)
    expect(logInsert!.value.intensity).toBe(70);
    expect(logInsert!.value.hrZoneDurations).toBeDefined();

    // Workout row inserted (exerciseId only lives on the log)
    const workoutInsert = inserts.find(
      (i) => i.value.whoopActivityId === WHOOP_ACTIVITY_ID,
    );
    expect(workoutInsert).toBeDefined();
    expect(workoutInsert!.value.source).toBe("whoop");

    // A personal_record row was inserted (longest_distance beats null prior best)
    const prInsert = inserts.find(
      (i) => i.value.recordType === "longest_distance",
    );
    expect(prInsert).toBeDefined();
    expect(prInsert!.value).toMatchObject({
      userId: USER_ID,
      exerciseId: EXERCISE_ID,
      recordType: "longest_distance",
      value: 10000,
      previousRecordValue: null,
    });

    // best_pace PR also recorded (10km in 60min → 360 s/km)
    const paceInsert = inserts.find((i) => i.value.recordType === "best_pace");
    expect(paceInsert).toBeDefined();
    expect(paceInsert!.value.value).toBeCloseTo(360, 5);
  });

  it("is idempotent: re-running with an already-imported activity skips it", async () => {
    mockFetch(RUNNING_ACTIVITY);

    // Dedupe lookup → activity already imported
    mockDb.select.mockReturnValueOnce(
      makeChain([{ whoopActivityId: WHOOP_ACTIVITY_ID }]),
    );

    const result = await userCaller.whoop.commit({
      activityIds: [WHOOP_ACTIVITY_ID],
    });

    expect(result).toEqual({ createdCount: 0, skippedCount: 1 });
    // No transaction (and therefore no inserts / PRs) for a fully-skipped import
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("does not insert a PR for non-running cardio (e.g. cycling)", async () => {
    const CYCLING_ACTIVITY = {
      ...RUNNING_ACTIVITY,
      id: "whoop-activity-bike-001",
      sport_id: 16,
      sport_name: "cycling",
      score: { ...RUNNING_ACTIVITY.score, distance_meter: 25000 },
    };
    mockFetch(CYCLING_ACTIVITY);

    // resolves cycling to a library exercise, but it is NOT running
    resolveWhoopExerciseId.mockResolvedValue({
      id: EXERCISE_ID,
      name: "Cycling",
    });

    mockDb.select.mockReturnValueOnce(makeChain([]));

    const inserts: Array<Record<string, unknown>> = [];
    mockTx.insert.mockImplementation(() =>
      makeChain([], (value) => {
        inserts.push(value as Record<string, unknown>);
      }),
    );

    const result = await userCaller.whoop.commit({
      activityIds: ["whoop-activity-bike-001"],
    });

    expect(result).toEqual({ createdCount: 1, skippedCount: 0 });

    // exerciseId still set + distanceMeter populated
    const logInsert = inserts.find((v) => v.order === 0 && v.workoutId);
    expect(logInsert!.exerciseId).toBe(EXERCISE_ID);
    expect(logInsert!.distanceMeter).toBe(25000);

    // No running PR rows for cycling
    const prInsert = inserts.find(
      (v) =>
        v.recordType === "longest_distance" || v.recordType === "best_pace",
    );
    expect(prInsert).toBeUndefined();
  });

  it("leaves exerciseId undefined when no library exercise resolves", async () => {
    const UNKNOWN_ACTIVITY = {
      ...RUNNING_ACTIVITY,
      id: "whoop-activity-unknown-001",
      sport_id: 999,
      sport_name: "some-unmapped-sport",
    };
    mockFetch(UNKNOWN_ACTIVITY);
    resolveWhoopExerciseId.mockResolvedValue(null);
    mockDb.select.mockReturnValueOnce(makeChain([]));

    const inserts: Array<Record<string, unknown>> = [];
    mockTx.insert.mockImplementation(() =>
      makeChain([], (value) => {
        inserts.push(value as Record<string, unknown>);
      }),
    );

    const result = await userCaller.whoop.commit({
      activityIds: ["whoop-activity-unknown-001"],
    });

    expect(result).toEqual({ createdCount: 1, skippedCount: 0 });

    const logInsert = inserts.find((v) => v.order === 0 && v.workoutId);
    // Falls back to sport name; exerciseId omitted (undefined)
    expect(logInsert!.exerciseName).toBe("some-unmapped-sport");
    expect(logInsert!.exerciseId).toBeUndefined();

    // No PRs without a resolved exercise
    const prInsert = inserts.find(
      (v) =>
        v.recordType === "longest_distance" || v.recordType === "best_pace",
    );
    expect(prInsert).toBeUndefined();
  });
});
