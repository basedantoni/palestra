/**
 * Tests: KOI-78 — shared Whoop workout upsert (whoop-upsert.ts)
 *
 * upsertWhoopWorkout is the single source of truth for the three-path dedup
 * logic previously duplicated across the webhook processor and the backfill.
 *
 * Covers:
 *  - new-import   : no existing workout → creates workout + exercise log, returns
 *                   { path: "new-import" } and records a running PR
 *  - auto-update  : existing source="whoop" workout → updates workout + log,
 *                   returns { path: "auto-update" } and records a running PR
 *  - manual-link  : existing source!="whoop" workout → updates only the linked
 *                   exercise log, returns { path: "manual-link" }, leaves the
 *                   workout row untouched, and records a running PR
 *  - recordRunningPrs is invoked after every log insert/update
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ────────────────────────────────────────────────────────────────────────────
// Hoisted mocks (must run before any imports)
// ────────────────────────────────────────────────────────────────────────────
const { mockDb, mockTx, makeChain, recordRunningPrsSpy, RESOLVED_EXERCISE } =
  vi.hoisted(() => {
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
      query: {},
    };

    const recordRunningPrsSpy = vi.fn().mockResolvedValue(undefined);

    // resolveWhoopExerciseId resolves to a canonical cardio exercise so PRs attach.
    const RESOLVED_EXERCISE = {
      id: "00000000-0000-4000-8000-0000000004ee",
      name: "Long Run",
    };

    return {
      mockDb,
      mockTx,
      makeChain,
      recordRunningPrsSpy,
      RESOLVED_EXERCISE,
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
  },
}));

vi.mock("../lib/whoop-client", () => ({
  WHOOP_API_BASE: "https://api.prod.whoop.com/developer/v2",
  getValidWhoopAccessToken: vi.fn().mockResolvedValue("mock-token"),
  resolveWhoopExerciseId: vi.fn().mockResolvedValue(RESOLVED_EXERCISE),
}));

// Spy on recordRunningPrs to assert it fires after every log insert/update,
// while still exercising the real three-path logic in whoop-upsert.ts.
vi.mock("../lib/personal-records", () => ({
  recordRunningPrs: recordRunningPrsSpy,
}));

import { upsertWhoopWorkout } from "../lib/whoop-upsert";

// ────────────────────────────────────────────────────────────────────────────
// Constants & fixtures
// ────────────────────────────────────────────────────────────────────────────
const USER_ID = "00000000-0000-4000-8000-000000000401";
const EXISTING_WORKOUT_ID = "00000000-0000-4000-8000-000000000402";
const LOG_ID = "00000000-0000-4000-8000-000000000403";
const WHOOP_ACTIVITY_ID = "whoop-upsert-act-1";

const SCORED_RUNNING_ACTIVITY = {
  id: WHOOP_ACTIVITY_ID,
  start: "2026-05-01T06:00:00.000Z",
  end: "2026-05-01T07:00:00.000Z",
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
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/** Dedup select on `db` — no existing workout for this whoopActivityId. */
function mockNoExistingWorkout() {
  mockDb.select.mockReturnValueOnce(makeChain([]));
}

/** Dedup select on `db` — existing whoop-sourced workout (auto-update path). */
function mockExistingWhoopWorkout() {
  mockDb.select.mockReturnValueOnce(
    makeChain([
      {
        id: EXISTING_WORKOUT_ID,
        source: "whoop",
        date: new Date("2026-05-01"),
        workoutType: "cardio",
      },
    ]),
  );
}

/** Dedup select on `db` — existing manually-created workout (manual-link path). */
function mockExistingManualWorkout() {
  mockDb.select.mockReturnValueOnce(
    makeChain([
      {
        id: EXISTING_WORKOUT_ID,
        source: "manual",
        date: new Date("2026-05-01"),
        workoutType: "cardio",
      },
    ]),
  );
}

/** Inside-transaction firstLog lookup on `tx.select`. */
function mockTxFirstLog() {
  mockTx.select.mockReturnValueOnce(
    makeChain([{ id: LOG_ID, exerciseId: RESOLVED_EXERCISE.id }]),
  );
}

describe("upsertWhoopWorkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.transaction.mockImplementation(async (fn: any) => fn(mockTx));
    // recordPr default reads via tx.select → return empty (no prior PR).
    mockTx.select.mockReturnValue(makeChain([]));
  });

  it("new-import: creates workout + log, records running PR, returns new-import path", async () => {
    mockNoExistingWorkout();

    const insertedValues: Array<Record<string, unknown>> = [];
    mockTx.insert.mockImplementation(() => ({
      values: vi.fn((val: unknown) => {
        insertedValues.push(val as Record<string, unknown>);
        return Promise.resolve([]);
      }),
    }));
    // lastImportedAt bump runs via tx.update
    mockTx.update.mockImplementation(() => ({
      set: () => ({ where: () => makeChain([]) }),
    }));

    const result = await upsertWhoopWorkout(USER_ID, SCORED_RUNNING_ACTIVITY);

    expect(result.path).toBe("new-import");
    expect(result.workoutId).toEqual(expect.any(String));
    // workout + exercise log inserts
    expect(mockTx.insert).toHaveBeenCalledTimes(2);

    const workoutInsert = insertedValues[0]!;
    expect(workoutInsert.source).toBe("whoop");
    expect(workoutInsert.whoopActivityId).toBe(WHOOP_ACTIVITY_ID);

    const logInsert = insertedValues[1]!;
    expect(logInsert.heartRate).toBe(155);
    expect(logInsert.distanceMeter).toBe(10000);

    // PR recorded after the log insert, attributed to the resolved exercise
    expect(recordRunningPrsSpy).toHaveBeenCalledTimes(1);
    expect(recordRunningPrsSpy).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        userId: USER_ID,
        exerciseId: RESOLVED_EXERCISE.id,
        workoutId: result.workoutId,
        distanceMeter: 10000,
      }),
    );
  });

  it("auto-update: updates existing whoop workout + log, records PR, returns auto-update path", async () => {
    mockExistingWhoopWorkout();
    mockTxFirstLog();

    const capturedSets: Array<Record<string, unknown>> = [];
    mockTx.update.mockImplementation(() => ({
      set: (val: unknown) => {
        capturedSets.push(val as Record<string, unknown>);
        return { where: () => makeChain([]) };
      },
    }));

    const result = await upsertWhoopWorkout(USER_ID, SCORED_RUNNING_ACTIVITY);

    expect(result.path).toBe("auto-update");
    expect(result.workoutId).toBe(EXISTING_WORKOUT_ID);
    // No new workout/log inserts on the update path
    expect(mockTx.insert).not.toHaveBeenCalled();

    // Exercise log metrics updated
    const logUpdate = capturedSets.find((s) => s.heartRate !== undefined);
    expect(logUpdate).toBeDefined();
    expect(logUpdate!.heartRate).toBe(155);
    expect(logUpdate!.distanceMeter).toBe(10000);

    // PR recorded after the log update
    expect(recordRunningPrsSpy).toHaveBeenCalledTimes(1);
    expect(recordRunningPrsSpy).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        userId: USER_ID,
        workoutId: EXISTING_WORKOUT_ID,
        distanceMeter: 10000,
      }),
    );
  });

  it("manual-link: updates only the linked log, leaves workout untouched, returns manual-link path", async () => {
    mockExistingManualWorkout();
    mockTxFirstLog();

    const capturedSets: Array<Record<string, unknown>> = [];
    mockTx.update.mockImplementation(() => ({
      set: (val: unknown) => {
        capturedSets.push(val as Record<string, unknown>);
        return { where: () => makeChain([]) };
      },
    }));

    const result = await upsertWhoopWorkout(USER_ID, SCORED_RUNNING_ACTIVITY);

    expect(result.path).toBe("manual-link");
    expect(result.workoutId).toBe(EXISTING_WORKOUT_ID);

    // No inserts on the manual-link path
    expect(mockTx.insert).not.toHaveBeenCalled();

    // The workout row itself must NOT be touched (no date/workoutType/source set)
    const workoutRowUpdate = capturedSets.find(
      (s) => s.workoutType !== undefined || s.source !== undefined,
    );
    expect(workoutRowUpdate).toBeUndefined();

    // The linked exercise log IS updated with metrics
    const logUpdate = capturedSets.find((s) => s.heartRate !== undefined);
    expect(logUpdate).toBeDefined();
    expect(logUpdate!.heartRate).toBe(155);

    // PR recorded after the log update, attributed to the existing log's exercise
    expect(recordRunningPrsSpy).toHaveBeenCalledTimes(1);
    expect(recordRunningPrsSpy).toHaveBeenCalledWith(
      mockTx,
      expect.objectContaining({
        userId: USER_ID,
        exerciseId: RESOLVED_EXERCISE.id,
        workoutId: EXISTING_WORKOUT_ID,
        distanceMeter: 10000,
      }),
    );
  });

  it("manual-link with no existing log: does not record a PR (nothing to update)", async () => {
    mockExistingManualWorkout();
    // tx firstLog lookup returns empty → no log to update
    mockTx.select.mockReturnValueOnce(makeChain([]));

    mockTx.update.mockImplementation(() => ({
      set: () => ({ where: () => makeChain([]) }),
    }));

    const result = await upsertWhoopWorkout(USER_ID, SCORED_RUNNING_ACTIVITY);

    expect(result.path).toBe("manual-link");
    expect(recordRunningPrsSpy).not.toHaveBeenCalled();
  });
});
