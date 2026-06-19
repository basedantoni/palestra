/**
 * Integration tests: Phase 3 — Whoop Workout Processor
 *
 * Covers:
 * 1. New import — workout.updated for unseen activity creates new workout + exercise log
 *    with source = "whoop", correct type, HR, intensity, zones
 * 2. Auto-imported update — workout.updated for existing source = "whoop" workout
 *    updates in place, no duplicate created
 * 3. Manual-link update — workout.updated for workout where source != "whoop" but
 *    whoopActivityId matches → exercise log metrics updated, workout itself unchanged
 * 4. PENDING_SCORE skipped — event marked skipped, no workout created
 * 5. INCOMPLETE imported — activity with score_state = "INCOMPLETE" creates workout
 *    with null score fields
 * 6. autoImportEnabled = false → event marked skipped, no workout rows written
 * 7. workout.deleted → workout row removed, event marked processed
 * 8. workout.deleted for non-existent activity → event still marked processed (idempotent)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ────────────────────────────────────────────────────────────────────────────
// Hoisted mocks (must run before any imports)
// ────────────────────────────────────────────────────────────────────────────
const {
  mockDb,
  mockTx,
  makeChain,
  mockGetValidToken,
  mockEnqueue,
} = vi.hoisted(() => {
  function makeChain(resolveWith: unknown = []) {
    const proxy: any = new Proxy(
      {},
      {
        get(_, prop: string) {
          if (prop === "then") {
            return (ok: any) => Promise.resolve(resolveWith).then(ok);
          }
          if (prop === "catch") {
            return (err: any) => Promise.resolve(resolveWith).catch(err);
          }
          if (prop === "finally") {
            return (fin: any) => Promise.resolve(resolveWith).finally(fin);
          }
          return () => proxy;
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

  const mockGetValidToken = vi.fn().mockResolvedValue("mock-access-token");
  const mockEnqueue = vi.fn().mockResolvedValue(undefined);

  return {
    mockDb,
    mockTx,
    makeChain,
    mockGetValidToken,
    mockEnqueue,
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
    TOKEN_ENCRYPTION_KEY:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  },
}));

vi.mock("../lib/whoop-client", () => ({
  WHOOP_API_BASE: "https://api.prod.whoop.com/developer/v2",
  getValidWhoopAccessToken: mockGetValidToken,
  resolveWhoopExerciseId: vi.fn().mockResolvedValue(null),
}));

vi.mock("../lib/recalc-queue", () => ({
  enqueueRecalcs: mockEnqueue,
}));

// Import after mocks
import { workoutProcessor, workoutDeleteProcessor } from "../lib/whoop-webhook";

// ────────────────────────────────────────────────────────────────────────────
// Test constants
// ────────────────────────────────────────────────────────────────────────────
const USER_ID = "00000000-0000-4000-8000-000000000201";
const WORKOUT_ID = "00000000-0000-4000-8000-000000000202";
const LOG_ID = "00000000-0000-4000-8000-000000000203";
const EVENT_ID = "evt-processor-test-001";
const WHOOP_ACTIVITY_ID = "whoop-act-9999";

// ────────────────────────────────────────────────────────────────────────────
// Sample Whoop API responses
// ────────────────────────────────────────────────────────────────────────────
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

const PENDING_SCORE_ACTIVITY = {
  id: WHOOP_ACTIVITY_ID,
  start: "2026-05-01T06:00:00.000Z",
  end: "2026-05-01T07:00:00.000Z",
  sport_id: 1,
  sport_name: "running",
  score_state: "PENDING_SCORE",
  score: null,
};

const INCOMPLETE_ACTIVITY = {
  id: WHOOP_ACTIVITY_ID,
  start: "2026-05-01T08:00:00.000Z",
  end: "2026-05-01T09:00:00.000Z",
  sport_id: 0,
  sport_name: "weightlifting",
  score_state: "INCOMPLETE",
  score: null,
};

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────
function mockFetch(responseBody: unknown, ok = true, status = 200) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    status,
    text: () => Promise.resolve(JSON.stringify(responseBody)),
    json: () => Promise.resolve(responseBody),
  } as unknown as Response);
}

/** Simulate a tx.update that captures set values */
function makeTxUpdateCapture(capturedSets: Array<Record<string, unknown>>) {
  return vi.fn(() => ({
    set: (val: unknown) => {
      capturedSets.push(val as Record<string, unknown>);
      return { where: () => makeChain([]) };
    },
  }));
}

/** Simulate an outer db.update (for marking event status) */
function mockDbUpdate() {
  mockDb.update.mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  });
}

/** Setup the autoImportEnabled + notifyOnAutoImport select response */
function mockAutoImportCheck(enabled: boolean, notify = false) {
  mockDb.select.mockReturnValueOnce(
    makeChain([{ autoImportEnabled: enabled, notifyOnAutoImport: notify }]),
  );
}

/** Setup the workout dedup select — no existing workout for this whoopActivityId */
function mockNoExistingWorkout() {
  mockDb.select.mockReturnValueOnce(makeChain([]));
}

/** Setup the workout dedup select — existing whoop-sourced workout */
function mockExistingWhoopWorkout() {
  mockDb.select.mockReturnValueOnce(
    makeChain([
      {
        id: WORKOUT_ID,
        source: "whoop",
        date: new Date("2026-05-01"),
        workoutType: "cardio",
      },
    ]),
  );
}

/** Setup the workout dedup select — existing manually-created workout with whoop link */
function mockExistingManualWorkout() {
  mockDb.select.mockReturnValueOnce(
    makeChain([
      {
        id: WORKOUT_ID,
        source: "manual",
        date: new Date("2026-05-01"),
        workoutType: "cardio",
      },
    ]),
  );
}

/**
 * Setup exercise log lookup for an existing workout.
 *
 * The firstLog lookup now runs inside the transaction (tx.select) via the
 * shared upsertWhoopWorkout helper. After the log update, recordRunningPrs
 * issues a further tx.select for the current PR best — that read defaults to
 * [] (no prior PR) via mockTx.select.mockReturnValue in beforeEach.
 */
function mockExistingExerciseLog() {
  mockTx.select.mockReturnValueOnce(
    makeChain([{ id: LOG_ID, exerciseId: null }]),
  );
}

/** Setup delete-processor workout lookup — workout found */
function mockDeleteWorkoutFound() {
  mockDb.select.mockReturnValueOnce(
    makeChain([{ id: WORKOUT_ID, date: new Date("2026-05-01") }]),
  );
}

/** Setup delete-processor workout lookup — no workout */
function mockDeleteWorkoutNotFound() {
  mockDb.select.mockReturnValueOnce(makeChain([]));
}

// ────────────────────────────────────────────────────────────────────────────
// Tests: workoutProcessor
// ────────────────────────────────────────────────────────────────────────────
/** Restore recalculation mocks to their default (resolved promise) implementations */
function restoreRecalcMocks() {
  mockEnqueue.mockResolvedValue(undefined);
}

describe("workoutProcessor — new import", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    restoreRecalcMocks();
    mockDb.transaction.mockImplementation(async (fn: any) => fn(mockTx));
    mockTx.select.mockReturnValue(makeChain([]));
    mockDbUpdate();
  });

  it("1. creates new workout + exercise log for unseen activity with correct fields", async () => {
    mockAutoImportCheck(true);
    mockFetch(SCORED_RUNNING_ACTIVITY);
    mockNoExistingWorkout();

    const insertedValues: Array<Record<string, unknown>> = [];
    mockTx.insert.mockImplementation(() => ({
      values: vi.fn((val: unknown) => {
        insertedValues.push(val as Record<string, unknown>);
        return Promise.resolve([]);
      }),
    }));
    mockTx.update = makeTxUpdateCapture([]);

    await workoutProcessor(EVENT_ID, USER_ID, WHOOP_ACTIVITY_ID);

    // Two inserts: workout + exercise log
    expect(mockTx.insert).toHaveBeenCalledTimes(2);

    const workoutInsert = insertedValues[0]!;
    expect(workoutInsert.source).toBe("whoop");
    expect(workoutInsert.whoopActivityId).toBe(WHOOP_ACTIVITY_ID);
    expect(workoutInsert.workoutType).toBe("cardio"); // running → cardio
    expect(workoutInsert.userId).toBe(USER_ID);
    expect(workoutInsert.date).toBeInstanceOf(Date);

    const logInsert = insertedValues[1]!;
    expect(logInsert.heartRate).toBe(155);
    expect(logInsert.intensity).toBe(70); // strain=14.7 → round(14.7/21*100) = 70
    expect(logInsert.distanceMeter).toBe(10000);
    expect(logInsert.durationMinutes).toBe(60);
    expect(logInsert.hrZoneDurations).toBeDefined();

    // Event marked processed
    expect(mockDb.update).toHaveBeenCalled();
  });

  it("1b. marks event processed after successful new import", async () => {
    mockAutoImportCheck(true);
    mockFetch(SCORED_RUNNING_ACTIVITY);
    mockNoExistingWorkout();

    const capturedUpdateSets: Array<Record<string, unknown>> = [];
    mockTx.insert.mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    });
    mockTx.update = makeTxUpdateCapture([]);

    // Capture the outer db.update calls (event status + connection lastImportedAt)
    mockDb.update.mockImplementation(() => ({
      set: vi.fn((val: unknown) => {
        capturedUpdateSets.push(val as Record<string, unknown>);
        return { where: vi.fn().mockResolvedValue([]) };
      }),
    }));

    await workoutProcessor(EVENT_ID, USER_ID, WHOOP_ACTIVITY_ID);

    // Find the update that sets status=processed
    const processedUpdate = capturedUpdateSets.find(
      (s) => s.status === "processed",
    );
    expect(processedUpdate).toBeDefined();
    expect(processedUpdate!.processedAt).toBeInstanceOf(Date);
  });
});

describe("workoutProcessor — auto-imported update (source = whoop)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    restoreRecalcMocks();
    mockDb.transaction.mockImplementation(async (fn: any) => fn(mockTx));
    mockTx.select.mockReturnValue(makeChain([]));
    mockDbUpdate();
  });

  it("2. updates existing whoop workout in place without creating a duplicate", async () => {
    mockAutoImportCheck(true);
    mockFetch(SCORED_RUNNING_ACTIVITY);
    mockExistingWhoopWorkout(); // dedup: existing whoop workout found
    mockExistingExerciseLog(); // exercise log lookup

    const capturedSets: Array<Record<string, unknown>> = [];
    mockTx.update = makeTxUpdateCapture(capturedSets);

    await workoutProcessor(EVENT_ID, USER_ID, WHOOP_ACTIVITY_ID);

    // No new workout insert should occur — only updates
    expect(mockTx.insert).not.toHaveBeenCalled();

    // Exercise log metrics should have been updated
    const logUpdate = capturedSets.find(
      (s) => s.heartRate !== undefined || s.intensity !== undefined,
    );
    expect(logUpdate).toBeDefined();
    expect(logUpdate!.heartRate).toBe(155);
    expect(logUpdate!.intensity).toBe(70);
  });
});

describe("workoutProcessor — manual-link update (source != whoop)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    restoreRecalcMocks();
    mockDb.transaction.mockImplementation(async (fn: any) => fn(mockTx));
    mockTx.select.mockReturnValue(makeChain([]));
    mockDbUpdate();
  });

  it("3. updates exercise log metrics without creating new workout or altering workout source", async () => {
    mockAutoImportCheck(true);
    mockFetch(SCORED_RUNNING_ACTIVITY);
    mockExistingManualWorkout(); // dedup: existing manual workout found
    mockExistingExerciseLog(); // exercise log lookup

    const capturedSets: Array<Record<string, unknown>> = [];
    mockTx.update = makeTxUpdateCapture(capturedSets);

    await workoutProcessor(EVENT_ID, USER_ID, WHOOP_ACTIVITY_ID);

    // No new workout insert
    expect(mockTx.insert).not.toHaveBeenCalled();

    // Workout row itself should NOT be updated (source stays manual)
    const workoutSourceUpdate = capturedSets.find(
      (s) => s.source !== undefined,
    );
    expect(workoutSourceUpdate).toBeUndefined();

    // Exercise log should have metrics updated
    const logUpdate = capturedSets.find((s) => s.heartRate !== undefined);
    expect(logUpdate).toBeDefined();
    expect(logUpdate!.heartRate).toBe(155);
    expect(logUpdate!.distanceMeter).toBe(10000);
  });
});

describe("workoutProcessor — PENDING_SCORE", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    restoreRecalcMocks();
    mockDbUpdate();
  });

  it("4. marks event skipped and creates no workout when score_state is PENDING_SCORE", async () => {
    mockAutoImportCheck(true);
    mockFetch(PENDING_SCORE_ACTIVITY);

    const capturedUpdateSets: Array<Record<string, unknown>> = [];
    mockDb.update.mockImplementation(() => ({
      set: vi.fn((val: unknown) => {
        capturedUpdateSets.push(val as Record<string, unknown>);
        return { where: vi.fn().mockResolvedValue([]) };
      }),
    }));

    await workoutProcessor(EVENT_ID, USER_ID, WHOOP_ACTIVITY_ID);

    // Transaction should NOT have been called (no DB writes for workout)
    expect(mockDb.transaction).not.toHaveBeenCalled();

    // Event should be marked skipped
    const skippedUpdate = capturedUpdateSets.find(
      (s) => s.status === "skipped",
    );
    expect(skippedUpdate).toBeDefined();
  });
});

describe("workoutProcessor — INCOMPLETE score_state", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    restoreRecalcMocks();
    mockDb.transaction.mockImplementation(async (fn: any) => fn(mockTx));
    mockTx.select.mockReturnValue(makeChain([]));
    mockDbUpdate();
  });

  it("5. imports INCOMPLETE activity with null score fields, no error", async () => {
    mockAutoImportCheck(true);
    mockFetch(INCOMPLETE_ACTIVITY);
    mockNoExistingWorkout();

    const insertedValues: Array<Record<string, unknown>> = [];
    mockTx.insert.mockImplementation(() => ({
      values: vi.fn((val: unknown) => {
        insertedValues.push(val as Record<string, unknown>);
        return Promise.resolve([]);
      }),
    }));
    mockTx.update = makeTxUpdateCapture([]);

    await workoutProcessor(EVENT_ID, USER_ID, WHOOP_ACTIVITY_ID);

    // Should have created workout + exercise log
    expect(mockTx.insert).toHaveBeenCalledTimes(2);

    const logInsert = insertedValues[1]!;
    // INCOMPLETE → score fields should be null
    expect(logInsert.heartRate).toBeNull();
    expect(logInsert.intensity).toBeNull();
    expect(logInsert.distanceMeter).toBeNull();
    expect(logInsert.hrZoneDurations).toBeNull();
    // duration is always set (from timestamps)
    expect(logInsert.durationMinutes).toBe(60);

    // Event should be marked processed
    expect(mockDb.update).toHaveBeenCalled();
  });
});

describe("workoutProcessor — autoImportEnabled = false", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    restoreRecalcMocks();
    mockDbUpdate();
  });

  it("6. marks event skipped without any workout DB writes when autoImport is disabled", async () => {
    mockAutoImportCheck(false);

    const capturedUpdateSets: Array<Record<string, unknown>> = [];
    mockDb.update.mockImplementation(() => ({
      set: vi.fn((val: unknown) => {
        capturedUpdateSets.push(val as Record<string, unknown>);
        return { where: vi.fn().mockResolvedValue([]) };
      }),
    }));

    await workoutProcessor(EVENT_ID, USER_ID, WHOOP_ACTIVITY_ID);

    // No Whoop API fetch (token not needed)
    expect(mockGetValidToken).not.toHaveBeenCalled();

    // No transaction (no workout/log writes)
    expect(mockDb.transaction).not.toHaveBeenCalled();

    // Event marked skipped
    const skippedUpdate = capturedUpdateSets.find(
      (s) => s.status === "skipped",
    );
    expect(skippedUpdate).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Tests: workoutDeleteProcessor
// ────────────────────────────────────────────────────────────────────────────
describe("workoutDeleteProcessor", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    restoreRecalcMocks();
    mockDbUpdate();
  });

  it("7. deletes workout row when found and marks event processed", async () => {
    mockDeleteWorkoutFound();

    const capturedUpdateSets: Array<Record<string, unknown>> = [];
    mockDb.update.mockImplementation(() => ({
      set: vi.fn((val: unknown) => {
        capturedUpdateSets.push(val as Record<string, unknown>);
        return { where: vi.fn().mockResolvedValue([]) };
      }),
    }));
    mockDb.delete.mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    });

    await workoutDeleteProcessor(EVENT_ID, USER_ID, WHOOP_ACTIVITY_ID);

    // Delete was called
    expect(mockDb.delete).toHaveBeenCalledOnce();

    // Recalculations were enqueued (week-volume only; no exercise ids)
    expect(mockEnqueue).toHaveBeenCalledWith(USER_ID, {
      weekDates: [expect.any(Date)],
    });

    // Event marked processed
    const processedUpdate = capturedUpdateSets.find(
      (s) => s.status === "processed",
    );
    expect(processedUpdate).toBeDefined();
  });

  it("8. marks event processed even when no workout found (idempotent)", async () => {
    mockDeleteWorkoutNotFound();

    const capturedUpdateSets: Array<Record<string, unknown>> = [];
    mockDb.update.mockImplementation(() => ({
      set: vi.fn((val: unknown) => {
        capturedUpdateSets.push(val as Record<string, unknown>);
        return { where: vi.fn().mockResolvedValue([]) };
      }),
    }));

    await workoutDeleteProcessor(EVENT_ID, USER_ID, WHOOP_ACTIVITY_ID);

    // Delete should NOT have been called
    expect(mockDb.delete).not.toHaveBeenCalled();

    // Still marks event processed
    const processedUpdate = capturedUpdateSets.find(
      (s) => s.status === "processed",
    );
    expect(processedUpdate).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Tests: notification emission (Phase 5)
// ────────────────────────────────────────────────────────────────────────────

/** Setup: autoImportEnabled + notifyOnAutoImport */
function mockAutoImportAndNotify(autoImport: boolean, notify: boolean) {
  mockDb.select.mockReturnValueOnce(
    makeChain([{ autoImportEnabled: autoImport, notifyOnAutoImport: notify }]),
  );
}

describe("workoutProcessor — notification emission", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    restoreRecalcMocks();
    mockDb.transaction.mockImplementation(async (fn: any) => fn(mockTx));
    mockTx.select.mockReturnValue(makeChain([]));
    mockDbUpdate();
  });

  it("9a. new import with notifyOnAutoImport=true → notification row inserted with correct type/title/message/workoutId", async () => {
    mockAutoImportAndNotify(true, true);
    mockFetch(SCORED_RUNNING_ACTIVITY);
    mockNoExistingWorkout();

    // Capture all inserts
    const insertedValues: Array<Record<string, unknown>> = [];
    mockTx.insert.mockImplementation(() => ({
      values: vi.fn((val: unknown) => {
        insertedValues.push(val as Record<string, unknown>);
        return Promise.resolve([]);
      }),
    }));
    mockTx.update = makeTxUpdateCapture([]);

    // Capture outer db.insert (notification)
    const outerInsertValues: Array<Record<string, unknown>> = [];
    mockDb.insert.mockImplementation(() => ({
      values: vi.fn((val: unknown) => {
        outerInsertValues.push(val as Record<string, unknown>);
        return Promise.resolve([]);
      }),
    }));

    await workoutProcessor(EVENT_ID, USER_ID, WHOOP_ACTIVITY_ID);

    // Notification insert should be among the outer inserts
    const notifInsert = outerInsertValues.find(
      (v) => v.type === "whoop_workout_imported",
    );
    expect(notifInsert).toBeDefined();
    expect(notifInsert!.userId).toBe(USER_ID);
    expect(typeof notifInsert!.title).toBe("string");
    expect(typeof notifInsert!.message).toBe("string");
    // message should include workout type and duration
    expect(notifInsert!.message).toMatch(/\d+\s*min/i);
    // payload should have workoutId
    expect(
      (notifInsert!.payload as Record<string, unknown>).workoutId,
    ).toBeDefined();
  });

  it("9b. new import with notifyOnAutoImport=false → no notification row", async () => {
    mockAutoImportAndNotify(true, false);
    mockFetch(SCORED_RUNNING_ACTIVITY);
    mockNoExistingWorkout();

    const insertedValues: Array<Record<string, unknown>> = [];
    mockTx.insert.mockImplementation(() => ({
      values: vi.fn((val: unknown) => {
        insertedValues.push(val as Record<string, unknown>);
        return Promise.resolve([]);
      }),
    }));
    mockTx.update = makeTxUpdateCapture([]);

    const outerInsertValues: Array<Record<string, unknown>> = [];
    mockDb.insert.mockImplementation(() => ({
      values: vi.fn((val: unknown) => {
        outerInsertValues.push(val as Record<string, unknown>);
        return Promise.resolve([]);
      }),
    }));

    await workoutProcessor(EVENT_ID, USER_ID, WHOOP_ACTIVITY_ID);

    const notifInsert = outerInsertValues.find(
      (v) => v.type === "whoop_workout_imported",
    );
    expect(notifInsert).toBeUndefined();
  });

  it("9c. manual-link update → no notification even with notifyOnAutoImport=true", async () => {
    mockAutoImportAndNotify(true, true);
    mockFetch(SCORED_RUNNING_ACTIVITY);
    mockExistingManualWorkout(); // Path 1 — manual link
    mockExistingExerciseLog();

    const capturedSets: Array<Record<string, unknown>> = [];
    mockTx.update = makeTxUpdateCapture(capturedSets);

    const outerInsertValues: Array<Record<string, unknown>> = [];
    mockDb.insert.mockImplementation(() => ({
      values: vi.fn((val: unknown) => {
        outerInsertValues.push(val as Record<string, unknown>);
        return Promise.resolve([]);
      }),
    }));

    await workoutProcessor(EVENT_ID, USER_ID, WHOOP_ACTIVITY_ID);

    const notifInsert = outerInsertValues.find(
      (v) => v.type === "whoop_workout_imported",
    );
    expect(notifInsert).toBeUndefined();
  });

  it("9d. auto-imported update (source=whoop) with notifyOnAutoImport=true → notification emitted", async () => {
    mockAutoImportAndNotify(true, true);
    mockFetch(SCORED_RUNNING_ACTIVITY);
    mockExistingWhoopWorkout(); // Path 2 — auto-imported update
    mockExistingExerciseLog();

    const capturedSets: Array<Record<string, unknown>> = [];
    mockTx.update = makeTxUpdateCapture(capturedSets);

    const outerInsertValues: Array<Record<string, unknown>> = [];
    mockDb.insert.mockImplementation(() => ({
      values: vi.fn((val: unknown) => {
        outerInsertValues.push(val as Record<string, unknown>);
        return Promise.resolve([]);
      }),
    }));

    await workoutProcessor(EVENT_ID, USER_ID, WHOOP_ACTIVITY_ID);

    const notifInsert = outerInsertValues.find(
      (v) => v.type === "whoop_workout_imported",
    );
    expect(notifInsert).toBeDefined();
    expect(notifInsert!.userId).toBe(USER_ID);
    // payload workoutId should match the existing workout ID
    expect((notifInsert!.payload as Record<string, unknown>).workoutId).toBe(
      WORKOUT_ID,
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Tests: recalculations fire after import
// ────────────────────────────────────────────────────────────────────────────
describe("workoutProcessor — recalculations", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    restoreRecalcMocks();
    mockDb.transaction.mockImplementation(async (fn: any) => fn(mockTx));
    mockTx.select.mockReturnValue(makeChain([]));
    mockDbUpdate();
  });

  it("enqueues week-volume recalc after new import", async () => {
    mockAutoImportCheck(true);
    mockFetch(SCORED_RUNNING_ACTIVITY);
    mockNoExistingWorkout();

    mockTx.insert.mockReturnValue({
      values: vi.fn().mockResolvedValue([]),
    });
    mockTx.update = makeTxUpdateCapture([]);

    await workoutProcessor(EVENT_ID, USER_ID, WHOOP_ACTIVITY_ID);

    expect(mockEnqueue).toHaveBeenCalledWith(USER_ID, {
      weekDates: [expect.any(Date)],
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Tests: error handling — processor never throws
// ────────────────────────────────────────────────────────────────────────────
describe("workoutProcessor — error handling", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    restoreRecalcMocks();
  });

  it("marks event failed when Whoop API fetch throws, does not bubble up", async () => {
    mockAutoImportCheck(true);
    // Simulate Whoop API error
    global.fetch = vi.fn().mockRejectedValue(new Error("network error"));

    const capturedUpdateSets: Array<Record<string, unknown>> = [];
    mockDb.update.mockImplementation(() => ({
      set: vi.fn((val: unknown) => {
        capturedUpdateSets.push(val as Record<string, unknown>);
        return { where: vi.fn().mockResolvedValue([]) };
      }),
    }));

    // Should NOT throw
    await expect(
      workoutProcessor(EVENT_ID, USER_ID, WHOOP_ACTIVITY_ID),
    ).resolves.not.toThrow();

    const failedUpdate = capturedUpdateSets.find((s) => s.status === "failed");
    expect(failedUpdate).toBeDefined();
    expect(typeof failedUpdate!.errorMessage).toBe("string");
  });
});
