/**
 * Integration tests: Phase 8 — Whoop Recovery Processor + tRPC procedures
 *
 * Covers:
 * 1. recovery.created → new whoop_recovery row with correct fields
 * 2. recovery.updated → existing row updated in place (no duplicate)
 * 3. recovery.deleted → row removed, event marked processed
 * 4. recovery.deleted for non-existent → still processed (idempotent)
 * 5. autoImportEnabled = false → skipped
 * 6. whoopRecovery.list returns rows ordered by createdAt desc with pagination
 * 7. whoopRecovery.latest returns most-recent row
 * 8. whoopRecovery.latest returns null when no rows
 * 9. Cross-phase regression: signed workout.updated payload still creates workout row
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ────────────────────────────────────────────────────────────────────────────
// Hoisted mocks (must run before any imports)
// ────────────────────────────────────────────────────────────────────────────
const { mockGetValidToken } = vi.hoisted(() => ({
  mockGetValidToken: vi.fn().mockResolvedValue("mock-access-token"),
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
    TOKEN_ENCRYPTION_KEY:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  },
}));

vi.mock("../lib/whoop-client", () => ({
  WHOOP_API_BASE: "https://api.prod.whoop.com/developer/v2",
  getValidWhoopAccessToken: mockGetValidToken,
  resolveWhoopExerciseId: vi.fn().mockResolvedValue(null),
}));

// Import after mocks
import {
  recoveryProcessor,
  recoveryDeleteProcessor,
} from "../lib/whoop-webhook";
import { appRouter } from "../routers/index";
import { whoopConnection, whoopRecovery, whoopWebhookEvent } from "@life-tracker/db/schema/index";
import { mockDb } from "./helpers/mock-db";

// ────────────────────────────────────────────────────────────────────────────
// Test constants
// ────────────────────────────────────────────────────────────────────────────
const USER_ID = "00000000-0000-4000-8000-000000000401";
const EVENT_ID = "evt-recovery-test-001";
const WHOOP_CYCLE_ID = "93845";

// ────────────────────────────────────────────────────────────────────────────
// Sample Whoop Recovery API response (v2)
// ────────────────────────────────────────────────────────────────────────────
const SCORED_RECOVERY = {
  cycle_id: 93845,
  sleep_id: 10235,
  created_at: "2026-05-06T17:00:00.000Z",
  updated_at: "2026-05-06T17:00:00.000Z",
  score_state: "SCORED",
  score: {
    recovery_score: 78,
    resting_heart_rate: 52.0,
    hrv_rmssd_milli: 68.4,
    spo2_percentage: 98.1,
    skin_temp_celsius: 33.7,
    user_calibrating: false,
  },
};

const SCORED_RECOVERY_UPDATED = {
  ...SCORED_RECOVERY,
  score: {
    ...SCORED_RECOVERY.score,
    recovery_score: 85,
    hrv_rmssd_milli: 75.2,
    user_calibrating: false,
  },
};

const CALIBRATING_RECOVERY = {
  ...SCORED_RECOVERY,
  score: {
    ...SCORED_RECOVERY.score,
    user_calibrating: true,
  },
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

function mockAutoImportCheck(enabled: boolean) {
  mockDb.onSelect(whoopConnection, [{ autoImportEnabled: enabled }]);
}

/** The .set() payload of each webhook-event status update. */
const eventUpdates = () =>
  mockDb.updated(whoopWebhookEvent).map((u) => u.set as Record<string, unknown>);

/** The upserted whoop_recovery rows. */
const upsertedValues = () => mockDb.inserted(whoopRecovery) as Array<Record<string, unknown>>;

// ────────────────────────────────────────────────────────────────────────────
// Tests: recoveryProcessor
// ────────────────────────────────────────────────────────────────────────────

describe("recoveryProcessor — new recovery record (recovery.created)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("1. creates new whoop_recovery row with correct fields from Whoop API response", async () => {
    mockAutoImportCheck(true);
    mockFetch(SCORED_RECOVERY);


    await recoveryProcessor(EVENT_ID, USER_ID, WHOOP_CYCLE_ID);

    // Whoop API was called with cycle ID
    expect(mockGetValidToken).toHaveBeenCalledWith(USER_ID);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/recovery/${WHOOP_CYCLE_ID}`),
      expect.any(Object),
    );

    // Insert/upsert was called
    expect(upsertedValues()).toHaveLength(1);
    const row = upsertedValues()[0]!;

    // Core fields
    expect(row.userId).toBe(USER_ID);
    expect(row.whoopCycleId).toBe(WHOOP_CYCLE_ID);
    expect(row.whoopSleepId).toBe("10235");
    expect(row.scoreState).toBe("SCORED");

    // Score fields
    expect(row.recoveryScore).toBe(78);
    expect(row.restingHr).toBeCloseTo(52.0);
    expect(row.hrv).toBeCloseTo(68.4);
    expect(row.spo2Pct).toBeCloseTo(98.1);
    expect(row.skinTempCelsius).toBeCloseTo(33.7);
    expect(row.userCalibrating).toBe(false);

    // Timestamps
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);

    // Event marked processed
    expect(eventUpdates()).toContainEqual(expect.objectContaining({ status: "processed" }));
  });
});

describe("recoveryProcessor — update existing row (recovery.updated)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("2. updates existing row in place — no duplicate created", async () => {
    mockAutoImportCheck(true);
    mockFetch(SCORED_RECOVERY_UPDATED);


    await recoveryProcessor(EVENT_ID, USER_ID, WHOOP_CYCLE_ID);

    // Single insert with onConflictDoUpdate (upsert — no duplicate)
    expect(upsertedValues()).toHaveLength(1);
    expect(mockDb.opsOn(whoopRecovery)[0]!.arg("onConflictDoUpdate")).toBeDefined();

    // Verify upserted value has updated score
    const row = upsertedValues()[0]!;
    expect(row.recoveryScore).toBe(85);
    expect(row.hrv).toBeCloseTo(75.2);

    // Event marked processed
    expect(eventUpdates()).toContainEqual(expect.objectContaining({ status: "processed" }));
  });
});

describe("recoveryProcessor — autoImportEnabled = false", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("5. marks event skipped without fetching from Whoop when autoImport is disabled", async () => {
    mockAutoImportCheck(false);


    await recoveryProcessor(EVENT_ID, USER_ID, WHOOP_CYCLE_ID);

    // No Whoop API fetch
    expect(mockGetValidToken).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();

    // No DB insert
    expect(mockDb.db.insert).not.toHaveBeenCalled();

    // Event marked skipped
    const skippedUpdate = eventUpdates().find(
      (s) => s.status === "skipped",
    );
    expect(skippedUpdate).toBeDefined();
  });
});

describe("recoveryProcessor — calibrating flag", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("stores userCalibrating = true when Whoop returns calibrating flag", async () => {
    mockAutoImportCheck(true);
    mockFetch(CALIBRATING_RECOVERY);


    await recoveryProcessor(EVENT_ID, USER_ID, WHOOP_CYCLE_ID);

    const row = upsertedValues()[0]!;
    expect(row.userCalibrating).toBe(true);
  });
});

describe("recoveryProcessor — error handling", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("marks event failed when Whoop API fetch fails, does not throw", async () => {
    mockAutoImportCheck(true);
    global.fetch = vi.fn().mockRejectedValue(new Error("network error"));


    await expect(
      recoveryProcessor(EVENT_ID, USER_ID, WHOOP_CYCLE_ID),
    ).resolves.not.toThrow();

    const failedUpdate = eventUpdates().find((s) => s.status === "failed");
    expect(failedUpdate).toBeDefined();
    expect(typeof failedUpdate!.errorMessage).toBe("string");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Tests: recoveryDeleteProcessor
// ────────────────────────────────────────────────────────────────────────────

describe("recoveryDeleteProcessor", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("3. deletes whoop_recovery row when found and marks event processed", async () => {
    // recovery row found
    mockDb.onSelect(whoopRecovery, [{ id: "recovery-row-abc" }]);


    await recoveryDeleteProcessor(EVENT_ID, USER_ID, WHOOP_CYCLE_ID);

    // Delete was called
    expect(mockDb.deleted(whoopRecovery)).toHaveLength(1);

    // Event marked processed
    const processedUpdate = eventUpdates().find(
      (s) => s.status === "processed",
    );
    expect(processedUpdate).toBeDefined();
  });

  it("4. marks event processed even when no recovery row found (idempotent)", async () => {
    // recovery row NOT found: nothing queued


    await recoveryDeleteProcessor(EVENT_ID, USER_ID, WHOOP_CYCLE_ID);

    // Delete should NOT have been called
    expect(mockDb.deleted(whoopRecovery)).toEqual([]);

    // Still marks event processed
    const processedUpdate = eventUpdates().find(
      (s) => s.status === "processed",
    );
    expect(processedUpdate).toBeDefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Tests: whoopRecovery tRPC procedures
// ────────────────────────────────────────────────────────────────────────────

const userCaller = appRouter.createCaller({
  session: {
    user: {
      id: USER_ID,
      email: "recovery@test.internal",
      name: "Recovery User",
    },
    session: {
      id: "sess-recovery",
      userId: USER_ID,
      expiresAt: new Date(Date.now() + 86400000),
    },
  },
  headers: new Headers(),
} as any);

const RECOVERY_ROW_1 = {
  id: "recovery-row-1",
  userId: USER_ID,
  whoopCycleId: "93845",
  whoopSleepId: "10235",
  createdAt: new Date("2026-05-06T17:00:00.000Z"),
  updatedAt: new Date("2026-05-06T17:00:00.000Z"),
  scoreState: "SCORED",
  recoveryScore: 78,
  restingHr: 52.0,
  hrv: 68.4,
  spo2Pct: 98.1,
  skinTempCelsius: 33.7,
  userCalibrating: false,
};

const RECOVERY_ROW_2 = {
  ...RECOVERY_ROW_1,
  id: "recovery-row-2",
  whoopCycleId: "93844",
  whoopSleepId: "10234",
  createdAt: new Date("2026-05-05T17:00:00.000Z"),
  updatedAt: new Date("2026-05-05T17:00:00.000Z"),
  recoveryScore: 65,
};

describe("whoopRecovery.list", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("6a. returns rows ordered by createdAt desc with correct pagination shape", async () => {
    mockDb.onSelect(whoopRecovery, [RECOVERY_ROW_1, RECOVERY_ROW_2]);

    const result = await userCaller.whoopRecovery.list({});

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
    // First item should be most recent
    expect(result.items[0]!.whoopCycleId).toBe("93845");
    expect(result.items[1]!.whoopCycleId).toBe("93844");
  });

  it("6b. returns nextCursor when there are more results (limit reached)", async () => {
    const rows = [
      RECOVERY_ROW_1,
      RECOVERY_ROW_2,
      { ...RECOVERY_ROW_2, id: "recovery-row-3", whoopCycleId: "93843" },
    ];

    mockDb.onSelect(whoopRecovery, rows);

    const result = await userCaller.whoopRecovery.list({ limit: 2 });

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).not.toBeNull();
  });

  it("6c. preserves the legacy default page size when bounds are omitted", async () => {
    const rows = Array.from({ length: 26 }, (_, index) => ({
      ...RECOVERY_ROW_1,
      id: `recovery-row-${index + 1}`,
      whoopCycleId: `${93845 - index}`,
      createdAt: new Date(
        `2026-05-${String((index % 28) + 1).padStart(2, "0")}T17:00:00.000Z`,
      ),
      updatedAt: new Date(
        `2026-05-${String((index % 28) + 1).padStart(2, "0")}T17:00:00.000Z`,
      ),
    }));

    mockDb.onSelect(whoopRecovery, rows);

    const result = await userCaller.whoopRecovery.list({});

    expect(result.items).toHaveLength(25);
    expect(result.nextCursor).not.toBeNull();
  });

  it("6d. returns the full in-range dataset when bounds are provided without a limit", async () => {
    const rows = Array.from({ length: 40 }, (_, index) => ({
      ...RECOVERY_ROW_1,
      id: `recovery-row-${index + 1}`,
      whoopCycleId: `${93845 - index}`,
      createdAt: new Date(
        `2026-05-${String((index % 28) + 1).padStart(2, "0")}T17:00:00.000Z`,
      ),
      updatedAt: new Date(
        `2026-05-${String((index % 28) + 1).padStart(2, "0")}T17:00:00.000Z`,
      ),
    }));

    mockDb.onSelect(whoopRecovery, rows);

    const result = await userCaller.whoopRecovery.list({
      from: "2026-05-01",
      to: "2026-05-31",
    });

    expect(result.items).toHaveLength(40);
    expect(result.nextCursor).toBeNull();
  });
});

describe("whoopRecovery.latest", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("7. returns the most recent recovery row", async () => {
    mockDb.onSelect(whoopRecovery, [RECOVERY_ROW_1]);

    const result = await userCaller.whoopRecovery.latest();

    expect(result).not.toBeNull();
    expect(result!.whoopCycleId).toBe("93845");
    expect(result!.recoveryScore).toBe(78);
    expect(result!.hrv).toBeCloseTo(68.4);
  });

  it("8. returns null when no recovery rows exist", async () => {
    mockDb.onSelect(whoopRecovery, []);

    const result = await userCaller.whoopRecovery.latest();

    expect(result).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Test 9: Cross-phase regression — workout.updated still works (Phase 3)
// ────────────────────────────────────────────────────────────────────────────

describe("Cross-phase regression: workout.updated still imports (Phase 3 unchanged)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("9. signed workout.updated payload still triggers workout row creation", async () => {
    // autoImportEnabled = true
    mockDb.onSelect(whoopConnection, [{ autoImportEnabled: true, notifyOnAutoImport: false }]);

    // No existing workout row: nothing queued

    // Mock Whoop activity API response
    const mockActivity = {
      id: "act-regression-001",
      start: "2026-05-06T07:00:00.000Z",
      end: "2026-05-06T08:00:00.000Z",
      sport_id: 1,
      sport_name: "Running",
      score_state: "SCORED",
      score: {
        strain: 12.5,
        average_heart_rate: 155,
        max_heart_rate: 180,
        distance_meter: 8000,
        zone_durations: {
          zone_zero_milli: 0,
          zone_one_milli: 120000,
          zone_two_milli: 180000,
          zone_three_milli: 300000,
          zone_four_milli: 240000,
          zone_five_milli: 60000,
        },
      },
    };

    mockFetch(mockActivity);

    // Import workoutProcessor
    const { workoutProcessor } = await import("../lib/whoop-webhook");

    await workoutProcessor("evt-regression-001", USER_ID, "act-regression-001");

    // Transaction was called (workout + exercise log created)
    expect(mockDb.db.transaction).toHaveBeenCalled();

    // Whoop API was fetched
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/activity/workout/act-regression-001"),
      expect.any(Object),
    );
  });
});
