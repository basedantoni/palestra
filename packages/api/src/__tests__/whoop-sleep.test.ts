/**
 * Integration tests: Phase 7 — Whoop Sleep Processor + tRPC procedures
 *
 * Covers:
 * 1. sleep.created → new whoop_sleep row created with correct fields
 * 2. sleep.updated → existing row updated in place (no duplicate)
 * 3. sleep.deleted → row removed, event marked processed
 * 4. sleep.deleted for non-existent ID → still marked processed (idempotent)
 * 5. autoImportEnabled = false → event marked skipped
 * 6. whoopSleep.list returns rows ordered by start desc with correct pagination
 * 7. whoopSleep.byId returns correct row
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ────────────────────────────────────────────────────────────────────────────
// Hoisted mocks (must run before any imports)
// ────────────────────────────────────────────────────────────────────────────
const { mockDb, mockTx, makeChain, mockGetValidToken } = vi.hoisted(() => {
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

  return { mockDb, mockTx, makeChain, mockGetValidToken };
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

// Import after mocks
import { sleepProcessor, sleepDeleteProcessor } from "../lib/whoop-webhook";
import { appRouter } from "../routers/index";

// ────────────────────────────────────────────────────────────────────────────
// Test constants
// ────────────────────────────────────────────────────────────────────────────
const USER_ID = "00000000-0000-4000-8000-000000000301";
const EVENT_ID = "evt-sleep-test-001";
const WHOOP_SLEEP_ID = "whoop-sleep-9999";

// ────────────────────────────────────────────────────────────────────────────
// Sample Whoop Sleep API response (v2)
// ────────────────────────────────────────────────────────────────────────────
const SCORED_SLEEP = {
  id: WHOOP_SLEEP_ID,
  nap: false,
  score_state: "SCORED",
  score: {
    sleep_performance_percentage: 85.2,
    sleep_consistency_percentage: 72.0,
    sleep_efficiency_percentage: 91.0,
    respiratory_rate: 15.3,
    stage_summary: {
      total_in_bed_time_milli: 28800000,
      total_awake_time_milli: 1200000,
      total_light_sleep_time_milli: 9000000,
      total_slow_wave_sleep_time_milli: 7200000,
      total_rem_sleep_time_milli: 9000000,
      total_no_data_time_milli: 0,
      disturbance_count: 3,
    },
  },
  start: "2026-05-06T06:00:00.000Z",
  end: "2026-05-06T14:00:00.000Z",
  user: { id: 12345 },
};

const SCORED_SLEEP_UPDATED = {
  ...SCORED_SLEEP,
  score: {
    ...SCORED_SLEEP.score,
    sleep_performance_percentage: 90.5,
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

function mockDbUpdate() {
  mockDb.update.mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  });
}

function mockAutoImportCheck(enabled: boolean) {
  mockDb.select.mockReturnValueOnce(
    makeChain([{ autoImportEnabled: enabled }]),
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Tests: sleepProcessor
// ────────────────────────────────────────────────────────────────────────────

describe("sleepProcessor — new sleep record (sleep.created)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDbUpdate();
  });

  it("1. creates new whoop_sleep row with correct fields from Whoop API response", async () => {
    mockAutoImportCheck(true);
    mockFetch(SCORED_SLEEP);

    const upsertedValues: Array<Record<string, unknown>> = [];
    mockDb.insert.mockImplementation(() => ({
      values: vi.fn((val: unknown) => {
        upsertedValues.push(val as Record<string, unknown>);
        return {
          onConflictDoUpdate: vi.fn().mockResolvedValue([]),
        };
      }),
    }));

    await sleepProcessor(EVENT_ID, USER_ID, WHOOP_SLEEP_ID);

    // Whoop API was called
    expect(mockGetValidToken).toHaveBeenCalledWith(USER_ID);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining(`/activity/sleep/${WHOOP_SLEEP_ID}`),
      expect.any(Object),
    );

    // Insert/upsert was called
    expect(mockDb.insert).toHaveBeenCalledOnce();
    const row = upsertedValues[0]!;

    // Core fields
    expect(row.userId).toBe(USER_ID);
    expect(row.whoopSleepId).toBe(WHOOP_SLEEP_ID);
    expect(row.nap).toBe(false);
    expect(row.scoreState).toBe("SCORED");

    // Score fields
    expect(row.performancePct).toBeCloseTo(85.2);
    expect(row.consistencyPct).toBeCloseTo(72.0);
    expect(row.efficiencyPct).toBeCloseTo(91.0);
    expect(row.respiratoryRate).toBeCloseTo(15.3);

    // Stage summary
    expect(row.totalInBedMilli).toBe(28800000);
    expect(row.totalAwakeMilli).toBe(1200000);
    expect(row.lightSleepMilli).toBe(9000000);
    expect(row.slowWaveMilli).toBe(7200000);
    expect(row.remMilli).toBe(9000000);
    expect(row.noDataMilli).toBe(0);
    expect(row.disturbanceCount).toBe(3);

    // Timestamps
    expect(row.start).toBeInstanceOf(Date);
    expect(row.end).toBeInstanceOf(Date);

    // Event marked processed
    expect(mockDb.update).toHaveBeenCalled();
  });
});

describe("sleepProcessor — update existing row (sleep.updated)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDbUpdate();
  });

  it("2. updates existing row in place — no duplicate created", async () => {
    mockAutoImportCheck(true);
    mockFetch(SCORED_SLEEP_UPDATED);

    let onConflictDoUpdateCalled = false;
    const upsertedValues: Array<Record<string, unknown>> = [];

    mockDb.insert.mockImplementation(() => ({
      values: vi.fn((val: unknown) => {
        upsertedValues.push(val as Record<string, unknown>);
        return {
          onConflictDoUpdate: vi.fn(() => {
            onConflictDoUpdateCalled = true;
            return Promise.resolve([]);
          }),
        };
      }),
    }));

    await sleepProcessor(EVENT_ID, USER_ID, WHOOP_SLEEP_ID);

    // Single insert with onConflictDoUpdate (upsert)
    expect(mockDb.insert).toHaveBeenCalledOnce();
    expect(onConflictDoUpdateCalled).toBe(true);

    // Verify the upserted value contains updated score
    const row = upsertedValues[0]!;
    expect(row.performancePct).toBeCloseTo(90.5);

    // Event marked processed
    expect(mockDb.update).toHaveBeenCalled();
  });
});

describe("sleepProcessor — autoImportEnabled = false", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDbUpdate();
  });

  it("5. marks event skipped without fetching from Whoop when autoImport is disabled", async () => {
    mockAutoImportCheck(false);

    const capturedUpdateSets: Array<Record<string, unknown>> = [];
    mockDb.update.mockImplementation(() => ({
      set: vi.fn((val: unknown) => {
        capturedUpdateSets.push(val as Record<string, unknown>);
        return { where: vi.fn().mockResolvedValue([]) };
      }),
    }));

    await sleepProcessor(EVENT_ID, USER_ID, WHOOP_SLEEP_ID);

    // No Whoop API fetch
    expect(mockGetValidToken).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();

    // No DB insert
    expect(mockDb.insert).not.toHaveBeenCalled();

    // Event marked skipped
    const skippedUpdate = capturedUpdateSets.find(
      (s) => s.status === "skipped",
    );
    expect(skippedUpdate).toBeDefined();
  });
});

describe("sleepProcessor — error handling", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("marks event failed when Whoop API fetch fails, does not throw", async () => {
    mockAutoImportCheck(true);
    global.fetch = vi.fn().mockRejectedValue(new Error("network error"));

    const capturedUpdateSets: Array<Record<string, unknown>> = [];
    mockDb.update.mockImplementation(() => ({
      set: vi.fn((val: unknown) => {
        capturedUpdateSets.push(val as Record<string, unknown>);
        return { where: vi.fn().mockResolvedValue([]) };
      }),
    }));

    await expect(
      sleepProcessor(EVENT_ID, USER_ID, WHOOP_SLEEP_ID),
    ).resolves.not.toThrow();

    const failedUpdate = capturedUpdateSets.find((s) => s.status === "failed");
    expect(failedUpdate).toBeDefined();
    expect(typeof failedUpdate!.errorMessage).toBe("string");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Tests: sleepDeleteProcessor
// ────────────────────────────────────────────────────────────────────────────

describe("sleepDeleteProcessor", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDbUpdate();
  });

  it("3. deletes whoop_sleep row when found and marks event processed", async () => {
    // sleep row found
    mockDb.select.mockReturnValueOnce(makeChain([{ id: WHOOP_SLEEP_ID }]));

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

    await sleepDeleteProcessor(EVENT_ID, USER_ID, WHOOP_SLEEP_ID);

    // Delete was called
    expect(mockDb.delete).toHaveBeenCalledOnce();

    // Event marked processed
    const processedUpdate = capturedUpdateSets.find(
      (s) => s.status === "processed",
    );
    expect(processedUpdate).toBeDefined();
  });

  it("4. marks event processed even when no sleep row found (idempotent)", async () => {
    // sleep row NOT found
    mockDb.select.mockReturnValueOnce(makeChain([]));

    const capturedUpdateSets: Array<Record<string, unknown>> = [];
    mockDb.update.mockImplementation(() => ({
      set: vi.fn((val: unknown) => {
        capturedUpdateSets.push(val as Record<string, unknown>);
        return { where: vi.fn().mockResolvedValue([]) };
      }),
    }));

    await sleepDeleteProcessor(EVENT_ID, USER_ID, WHOOP_SLEEP_ID);

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
// Tests: whoopSleep tRPC procedures
// (These test the router procedures via the caller pattern, mocking db directly)
// ────────────────────────────────────────────────────────────────────────────

const userCaller = appRouter.createCaller({
  session: {
    user: { id: USER_ID, email: "sleep@test.internal", name: "Sleep User" },
    session: {
      id: "sess-sleep",
      userId: USER_ID,
      expiresAt: new Date(Date.now() + 86400000),
    },
  },
  headers: new Headers(),
} as any);

const SLEEP_ROW_1 = {
  id: "sleep-row-1",
  userId: USER_ID,
  whoopSleepId: "whoop-sleep-001",
  start: new Date("2026-05-06T06:00:00.000Z"),
  end: new Date("2026-05-06T14:00:00.000Z"),
  nap: false,
  scoreState: "SCORED",
  performancePct: 85.2,
  consistencyPct: 72.0,
  efficiencyPct: 91.0,
  respiratoryRate: 15.3,
  totalInBedMilli: 28800000,
  totalAwakeMilli: 1200000,
  lightSleepMilli: 9000000,
  slowWaveMilli: 7200000,
  remMilli: 9000000,
  noDataMilli: 0,
  disturbanceCount: 3,
  createdAt: new Date("2026-05-06T14:01:00.000Z"),
};

const SLEEP_ROW_2 = {
  ...SLEEP_ROW_1,
  id: "sleep-row-2",
  whoopSleepId: "whoop-sleep-002",
  start: new Date("2026-05-05T06:00:00.000Z"),
  end: new Date("2026-05-05T14:00:00.000Z"),
  performancePct: 78.0,
  createdAt: new Date("2026-05-05T14:01:00.000Z"),
};

describe("whoopSleep.list", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("6a. returns rows ordered by start desc with correct pagination shape", async () => {
    // Returns 2 rows (limit=25 by default, so nextCursor = null)
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([SLEEP_ROW_1, SLEEP_ROW_2]),
          }),
        }),
      }),
    });

    const result = await userCaller.whoopSleep.list({});

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
    // First item should be most recent (start desc)
    expect(result.items[0]!.whoopSleepId).toBe("whoop-sleep-001");
    expect(result.items[1]!.whoopSleepId).toBe("whoop-sleep-002");
  });

  it("6b. returns nextCursor when there are more results (limit reached)", async () => {
    // Simulate limit=2, returns 3 rows → has more
    const rows = [
      SLEEP_ROW_1,
      SLEEP_ROW_2,
      { ...SLEEP_ROW_2, id: "sleep-row-3", whoopSleepId: "whoop-sleep-003" },
    ];

    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(rows),
          }),
        }),
      }),
    });

    const result = await userCaller.whoopSleep.list({ limit: 2 });

    // Should return 2 items and have a nextCursor
    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).not.toBeNull();
  });
});

describe("whoopSleep.byId", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("7. returns the correct sleep row by id", async () => {
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([SLEEP_ROW_1]),
      }),
    });

    const result = await userCaller.whoopSleep.byId({ id: "sleep-row-1" });

    expect(result).not.toBeNull();
    expect(result!.id).toBe("sleep-row-1");
    expect(result!.whoopSleepId).toBe("whoop-sleep-001");
    expect(result!.performancePct).toBeCloseTo(85.2);
  });

  it("7b. returns null when sleep row not found", async () => {
    mockDb.select.mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const result = await userCaller.whoopSleep.byId({ id: "nonexistent" });

    expect(result).toBeNull();
  });
});
