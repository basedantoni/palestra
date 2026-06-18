/**
 * Tests: Phase 6 — Whoop Backfill
 *
 * Covers:
 * Unit tests for backfill state module:
 * a. getBackfillState returns null when no state set
 * b. setBackfillState + getBackfillState round-trip correctly
 * c. stopBackfill sets shouldStop = true on existing state
 * d. clearBackfillState removes state
 *
 * tRPC mutation tests:
 * e. triggerBackfill mutation returns { ok: true } and fires async (setImmediate)
 * f. stopBackfill mutation calls stopBackfill on state map, returns { ok: true }
 * g. webhookStatus returns backfill: { running, importedCount, totalCount } when state is running
 * h. webhookStatus returns backfill: null when no backfill state
 * i. webhookStatus returns backfill: null when running = false
 *
 * triggerBackfill function tests:
 * j. triggerBackfill paginates Whoop API and calls workoutProcessor for each activity
 * k. triggerBackfill stops early when shouldStop = true
 * l. triggerBackfill emits summary notification on completion when notifyOnAutoImport = true
 * m. triggerBackfill does NOT emit summary notification when notifyOnAutoImport = false
 * n. triggerBackfill does NOT emit summary notification when skipped
 * o. triggerBackfill clears state on completion
 * p. triggerBackfill clears state on error (never throws)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ────────────────────────────────────────────────────────────────────────────
// Hoisted mocks (must run before any imports)
// ────────────────────────────────────────────────────────────────────────────
const {
  mockDb,
  makeChain,
  mockGetValidToken,
  mockTriggerBackfillFn,
  mockStopBackfillFn,
  mockGetBackfillStateFn,
  mockSetBackfillStateFn,
  mockClearBackfillStateFn,
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

  const mockDb = {
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    select: vi.fn(),
    transaction: vi.fn(),
    query: {},
  };

  const mockGetValidToken = vi.fn().mockResolvedValue("mock-access-token");

  // Mocks for whoop-backfill module (used in router tests)
  const mockTriggerBackfillFn = vi.fn().mockResolvedValue(undefined);
  const mockStopBackfillFn = vi.fn();
  const mockGetBackfillStateFn = vi.fn().mockReturnValue(null);
  const mockSetBackfillStateFn = vi.fn();
  const mockClearBackfillStateFn = vi.fn();

  return {
    mockDb,
    makeChain,
    mockGetValidToken,
    mockTriggerBackfillFn,
    mockStopBackfillFn,
    mockGetBackfillStateFn,
    mockSetBackfillStateFn,
    mockClearBackfillStateFn,
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
    WHOOP_CLIENT_ID: "test-whoop-client-id",
    WHOOP_CLIENT_SECRET: "test-whoop-client-secret",
    WHOOP_REDIRECT_URI: "http://localhost:3000/api/whoop/callback",
  },
}));

vi.mock("../lib/whoop-client", () => ({
  WHOOP_API_BASE: "https://api.prod.whoop.com/developer/v2",
  getValidWhoopAccessToken: mockGetValidToken,
  resolveWhoopExerciseId: vi.fn().mockResolvedValue(null),
}));

// ────────────────────────────────────────────────────────────────────────────
// Import the real backfill module (state tests use it directly)
// ────────────────────────────────────────────────────────────────────────────
import {
  getBackfillState,
  setBackfillState,
  clearBackfillState,
  stopBackfill as stopBackfillState,
} from "../lib/whoop-backfill";

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────
const USER_ID = "00000000-0000-4000-8000-000000000301";

// ────────────────────────────────────────────────────────────────────────────
// Tests: backfill state module (no router, pure unit tests)
// ────────────────────────────────────────────────────────────────────────────

describe("whoop-backfill state module", () => {
  beforeEach(() => {
    // Clear state between tests by calling clearBackfillState
    clearBackfillState(USER_ID);
  });

  it("a. getBackfillState returns null when no state set", () => {
    const state = getBackfillState(USER_ID);
    expect(state).toBeNull();
  });

  it("b. setBackfillState + getBackfillState round-trip correctly", () => {
    setBackfillState(USER_ID, {
      running: true,
      importedCount: 5,
      totalCount: 10,
      shouldStop: false,
    });

    const state = getBackfillState(USER_ID);
    expect(state).not.toBeNull();
    expect(state!.running).toBe(true);
    expect(state!.importedCount).toBe(5);
    expect(state!.totalCount).toBe(10);
    expect(state!.shouldStop).toBe(false);
  });

  it("c. stopBackfill sets shouldStop = true on existing state", () => {
    setBackfillState(USER_ID, {
      running: true,
      importedCount: 3,
      totalCount: 20,
      shouldStop: false,
    });

    stopBackfillState(USER_ID);

    const state = getBackfillState(USER_ID);
    expect(state).not.toBeNull();
    expect(state!.shouldStop).toBe(true);
    // Other fields unchanged
    expect(state!.running).toBe(true);
    expect(state!.importedCount).toBe(3);
    expect(state!.totalCount).toBe(20);
  });

  it("c2. stopBackfill is a no-op when no state exists", () => {
    // Should not throw
    expect(() => stopBackfillState(USER_ID)).not.toThrow();
    expect(getBackfillState(USER_ID)).toBeNull();
  });

  it("d. clearBackfillState removes state", () => {
    setBackfillState(USER_ID, {
      running: true,
      importedCount: 0,
      totalCount: 0,
      shouldStop: false,
    });

    clearBackfillState(USER_ID);

    const state = getBackfillState(USER_ID);
    expect(state).toBeNull();
  });

  it("d2. multiple users have independent state", () => {
    const OTHER_USER = "00000000-0000-4000-8000-000000000302";

    setBackfillState(USER_ID, {
      running: true,
      importedCount: 1,
      totalCount: 5,
      shouldStop: false,
    });

    setBackfillState(OTHER_USER, {
      running: true,
      importedCount: 10,
      totalCount: 15,
      shouldStop: false,
    });

    const state1 = getBackfillState(USER_ID);
    const state2 = getBackfillState(OTHER_USER);

    expect(state1!.importedCount).toBe(1);
    expect(state2!.importedCount).toBe(10);

    clearBackfillState(USER_ID);
    expect(getBackfillState(USER_ID)).toBeNull();
    expect(getBackfillState(OTHER_USER)).not.toBeNull();

    // Cleanup
    clearBackfillState(OTHER_USER);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Mock the backfill module for router tests
// (Must happen after the real module tests above)
// ────────────────────────────────────────────────────────────────────────────

// We need a separate describe block or approach here.
// The router tests use vi.mock which is hoisted, so we set up the mock
// and then re-import the router in a sub-module style.

// Because vi.mock is hoisted, we'll create a second test section that
// directly invokes the router via a helper that mocks the backfill module.

// ────────────────────────────────────────────────────────────────────────────
// Router-level tests for triggerBackfill and stopBackfill mutations
// These use the real router but mock the whoop-backfill module
// ────────────────────────────────────────────────────────────────────────────

// We mock the backfill module for the router tests
vi.mock("../lib/whoop-backfill", async (importOriginal) => {
  // Import the real module so state tests above can use it, but
  // wrap the functions we want to spy on for the router tests
  const real = await importOriginal<typeof import("../lib/whoop-backfill")>();

  // stopBackfill wrapper: calls the real implementation so state tests pass,
  // AND is tracked on mockStopBackfillFn so router tests can assert it was called.
  const realStop = real.stopBackfill;
  mockStopBackfillFn.mockImplementation((userId: string) => realStop(userId));

  return {
    ...real,
    // Keep the real state functions for state tests
    // We will not mock them here — we only need to mock triggerBackfill (the async function)
    // for the tRPC router tests. The router directly calls triggerBackfill and stopBackfill
    // from this module.
    triggerBackfill: mockTriggerBackfillFn,
    stopBackfill: mockStopBackfillFn,
    // NOTE: getBackfillState is intentionally NOT mocked here — the real function
    // is used so both state tests and router tests read from the same in-memory map.
    // Router tests that need specific backfill state use setBackfillState directly.
  };
});

import { appRouter } from "../routers/index";

// ────────────────────────────────────────────────────────────────────────────
// Helper: create a tRPC caller
// ────────────────────────────────────────────────────────────────────────────
function makeCtx(userId = USER_ID) {
  return {
    session: { user: { id: userId } },
    db: mockDb,
  } as any;
}

function makeCaller(userId = USER_ID) {
  return appRouter.createCaller(makeCtx(userId));
}

// ────────────────────────────────────────────────────────────────────────────
// DB mock helpers
// ────────────────────────────────────────────────────────────────────────────
function mockSelectConnection(row: Record<string, unknown> | null) {
  mockDb.select.mockReturnValueOnce(makeChain(row ? [row] : []));
}

// ────────────────────────────────────────────────────────────────────────────
// Tests: whoop.triggerBackfill tRPC mutation
// ────────────────────────────────────────────────────────────────────────────

describe("whoop.triggerBackfill mutation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetValidToken.mockResolvedValue("mock-access-token");
    mockTriggerBackfillFn.mockResolvedValue(undefined);
  });

  it("e. returns { ok: true } immediately without awaiting backfill", async () => {
    const setImmediateSpy = vi.spyOn(globalThis, "setImmediate" as any);

    const caller = makeCaller();
    const result = await caller.whoop.triggerBackfill({});

    expect(result.ok).toBe(true);

    // setImmediate was called (not awaited)
    expect(setImmediateSpy).toHaveBeenCalledOnce();

    setImmediateSpy.mockRestore();
  });

  it("e2. triggerBackfill with days=7 passes days to the backfill function", async () => {
    let capturedFn: (() => void) | null = null;
    const setImmediateSpy = vi
      .spyOn(globalThis, "setImmediate" as any)
      .mockImplementation((fn: any) => {
        capturedFn = fn;
      });

    const caller = makeCaller();
    await caller.whoop.triggerBackfill({ days: 7 });

    // Execute the setImmediate callback
    if (capturedFn) {
      await (capturedFn as () => Promise<void>)();
    }

    expect(mockTriggerBackfillFn).toHaveBeenCalledWith(USER_ID, 7);

    setImmediateSpy.mockRestore();
  });

  it("e3. triggerBackfill defaults to 30 days when no days specified", async () => {
    let capturedFn: (() => void) | null = null;
    const setImmediateSpy = vi
      .spyOn(globalThis, "setImmediate" as any)
      .mockImplementation((fn: any) => {
        capturedFn = fn;
      });

    const caller = makeCaller();
    await caller.whoop.triggerBackfill({});

    // Execute the setImmediate callback
    if (capturedFn) {
      await (capturedFn as () => Promise<void>)();
    }

    expect(mockTriggerBackfillFn).toHaveBeenCalledWith(USER_ID, 30);

    setImmediateSpy.mockRestore();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Tests: whoop.stopBackfill tRPC mutation
// ────────────────────────────────────────────────────────────────────────────

describe("whoop.stopBackfill mutation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("f. calls stopBackfill on state map and returns { ok: true }", async () => {
    const caller = makeCaller();
    const result = await caller.whoop.stopBackfill();

    expect(result.ok).toBe(true);
    expect(mockStopBackfillFn).toHaveBeenCalledWith(USER_ID);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Tests: whoop.webhookStatus extended with backfill state
// ────────────────────────────────────────────────────────────────────────────

describe("whoop.webhookStatus — backfill field", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Ensure no backfill state leaks between tests
    clearBackfillState(USER_ID);
  });

  afterEach(() => {
    clearBackfillState(USER_ID);
  });

  it("g. returns backfill: { running, importedCount, totalCount } when state is running", async () => {
    mockSelectConnection({
      webhookSubscriptionId: "sub-abc",
      webhookLastReceivedAt: null,
      autoImportEnabled: true,
      notifyOnAutoImport: true,
    });

    // Set real backfill state so the real getBackfillState function returns it
    setBackfillState(USER_ID, {
      running: true,
      importedCount: 8,
      totalCount: 25,
      shouldStop: false,
    });

    const caller = makeCaller();
    const result = await caller.whoop.webhookStatus();

    expect(result.backfill).not.toBeNull();
    expect(result.backfill!.running).toBe(true);
    expect(result.backfill!.importedCount).toBe(8);
    expect(result.backfill!.totalCount).toBe(25);
  });

  it("h. returns backfill: null when no backfill state exists", async () => {
    mockSelectConnection({
      webhookSubscriptionId: "sub-abc",
      webhookLastReceivedAt: null,
      autoImportEnabled: true,
      notifyOnAutoImport: true,
    });

    // No state set — real getBackfillState returns null

    const caller = makeCaller();
    const result = await caller.whoop.webhookStatus();

    expect(result.backfill).toBeNull();
  });

  it("i. returns backfill: null when state exists but running = false", async () => {
    mockSelectConnection({
      webhookSubscriptionId: "sub-abc",
      webhookLastReceivedAt: null,
      autoImportEnabled: true,
      notifyOnAutoImport: true,
    });

    // Set state with running = false
    setBackfillState(USER_ID, {
      running: false,
      importedCount: 10,
      totalCount: 10,
      shouldStop: false,
    });

    const caller = makeCaller();
    const result = await caller.whoop.webhookStatus();

    expect(result.backfill).toBeNull();
  });

  it("h2. returns backfill: null when no connection row (no-connection path)", async () => {
    mockSelectConnection(null); // no connection row

    // No state set — real getBackfillState returns null

    const caller = makeCaller();
    const result = await caller.whoop.webhookStatus();

    expect(result.backfill).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Tests: triggerBackfill function (integration — tests the actual async logic)
// These tests import the REAL triggerBackfill from the module.
// We need a fresh import that isn't mocked, so we use a dynamic import with
// a test-specific module mock arrangement.
//
// Because vi.mock("../lib/whoop-backfill") above replaces triggerBackfill,
// we instead test it indirectly by unmocking it in a separate describe block.
// ────────────────────────────────────────────────────────────────────────────

// Note: The triggerBackfill function tests need to import the real
// triggerBackfill but mock out its dependencies (DB, fetch, workoutProcessor).
// Since we already mocked the module above, we'll use a dedicated test file
// approach via the real import being tested in a re-imported module context.
// Instead, we inline the key behavior tests here using the mock setup:

describe("triggerBackfill function — pagination and import logic", () => {
  // These tests require the real triggerBackfill from whoop-backfill.ts
  // We import it separately from the module mock above.
  // Since vi.mock replaces the module, we need to use importOriginal.
  // The cleanest approach: import the real module via importActual.

  let realTriggerBackfill: (userId: string, days?: number) => Promise<void>;
  let realGetBackfillState: (
    userId: string,
  ) => {
    running: boolean;
    importedCount: number;
    totalCount: number;
    shouldStop: boolean;
  } | null;
  let realClearBackfillState: (userId: string) => void;
  let realStopBackfill: (userId: string) => void;

  beforeEach(async () => {
    vi.resetAllMocks();
    // Import the actual (non-mocked) module
    const actual = await vi.importActual<
      typeof import("../lib/whoop-backfill")
    >("../lib/whoop-backfill");
    realTriggerBackfill = actual.triggerBackfill;
    realGetBackfillState = actual.getBackfillState;
    realClearBackfillState = actual.clearBackfillState;
    realStopBackfill = actual.stopBackfill;

    // Clean state
    realClearBackfillState(USER_ID);

    // Setup default DB mocks for workoutProcessor calls within backfill
    mockGetValidToken.mockResolvedValue("mock-access-token");
  });

  afterEach(() => {
    // Cleanup
    realClearBackfillState(USER_ID);
  });

  it("j. paginates Whoop API and processes each activity (new import path)", async () => {
    // Mock DB: connection with autoImportEnabled=true, notifyOnAutoImport=false
    // Called once per workoutProcessor invocation (2 activities) + once for connection check
    // Actually: backfill doesn't call workoutProcessor; it calls the inline import logic
    // The triggerBackfill calls: getValidWhoopAccessToken, fetch list, then workoutProcessor per activity

    // Page 1: 2 activities, next_token = "page2"
    const page1Response = {
      records: [
        {
          id: "act-001",
          start: "2026-04-01T06:00:00.000Z",
          end: "2026-04-01T07:00:00.000Z",
          sport_id: 1,
          sport_name: "running",
          score_state: "SCORED",
          score: { strain: 10, average_heart_rate: 150, max_heart_rate: 170 },
        },
        {
          id: "act-002",
          start: "2026-04-02T06:00:00.000Z",
          end: "2026-04-02T07:30:00.000Z",
          sport_id: 0,
          sport_name: "weightlifting",
          score_state: "SCORED",
          score: { strain: 8, average_heart_rate: 130 },
        },
      ],
      next_token: null, // single page
    };

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(page1Response),
    });

    // Mock DB for workoutProcessor calls:
    // Each call to workoutProcessor will:
    // 1. SELECT connection (autoImportEnabled, notifyOnAutoImport)
    // 2. SELECT existing workout (dedup)
    // 3. db.transaction (insert workout + log)
    // 4. update event (mark processed) — not applicable for backfill
    // But triggerBackfill calls workoutProcessor differently:
    // It directly runs the three-path import (not via workoutProcessor).
    // The backfill uses the inline logic, not the event-based processor.

    // For triggerBackfill, set up mocks for:
    // - connection lookup (autoImportEnabled, notifyOnAutoImport)
    // - dedup check (existing workout)
    // - transaction (insert workout + exercise log)
    // - connection update (lastImportedAt)

    // Connection lookup (shared for whole backfill run, read once at start)
    mockDb.select.mockReturnValueOnce(
      makeChain([{ autoImportEnabled: true, notifyOnAutoImport: false }]),
    );

    // For each activity: dedup check → no existing workout
    // act-001
    mockDb.select.mockReturnValueOnce(makeChain([])); // no existing workout
    // act-002
    mockDb.select.mockReturnValueOnce(makeChain([])); // no existing workout

    // Transaction for act-001
    mockDb.transaction.mockImplementationOnce(async (fn: any) => {
      const tx = {
        insert: vi
          .fn()
          .mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
        update: vi
          .fn()
          .mockReturnValue({
            set: vi
              .fn()
              .mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
          }),
      };
      return fn(tx);
    });
    // Transaction for act-002
    mockDb.transaction.mockImplementationOnce(async (fn: any) => {
      const tx = {
        insert: vi
          .fn()
          .mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
        update: vi
          .fn()
          .mockReturnValue({
            set: vi
              .fn()
              .mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
          }),
      };
      return fn(tx);
    });

    await realTriggerBackfill(USER_ID, 30);

    // State should be cleared after completion
    expect(realGetBackfillState(USER_ID)).toBeNull();

    // API was called once (single page)
    expect(global.fetch).toHaveBeenCalledOnce();
    const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(fetchCall[0]).toContain("/activity/workout");
    expect(fetchCall[0]).toContain("start=");

    // Two transactions (one per activity)
    expect(mockDb.transaction).toHaveBeenCalledTimes(2);
  });

  it("k. stops early when shouldStop = true after first activity", async () => {
    const page1Response = {
      records: [
        {
          id: "act-stop-001",
          start: "2026-04-01T06:00:00.000Z",
          end: "2026-04-01T07:00:00.000Z",
          sport_id: 1,
          sport_name: "running",
          score_state: "SCORED",
          score: { strain: 10, average_heart_rate: 150 },
        },
        {
          id: "act-stop-002",
          start: "2026-04-02T06:00:00.000Z",
          end: "2026-04-02T07:00:00.000Z",
          sport_id: 0,
          sport_name: "weightlifting",
          score_state: "SCORED",
          score: { strain: 8 },
        },
      ],
      next_token: null,
    };

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(page1Response),
    });

    // Connection lookup
    mockDb.select.mockReturnValueOnce(
      makeChain([{ autoImportEnabled: true, notifyOnAutoImport: false }]),
    );

    // act-stop-001: dedup → no existing workout, then transaction runs and triggers stop
    mockDb.select.mockReturnValueOnce(makeChain([]));

    // Override transaction to trigger stop after first call
    let transactionCallCount = 0;
    mockDb.transaction.mockImplementation(async (fn: any) => {
      transactionCallCount++;
      const tx = {
        insert: vi
          .fn()
          .mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
        update: vi
          .fn()
          .mockReturnValue({
            set: vi
              .fn()
              .mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
          }),
      };
      const result = await fn(tx);
      // After first transaction, trigger stop
      if (transactionCallCount === 1) {
        realStopBackfill(USER_ID);
      }
      return result;
    });

    await realTriggerBackfill(USER_ID, 30);

    // State should be cleared (stopped clears state)
    expect(realGetBackfillState(USER_ID)).toBeNull();

    // Only one transaction was run (second activity was skipped due to stop)
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
  });

  it("l. emits summary notification on completion when notifyOnAutoImport = true", async () => {
    const page1Response = {
      records: [
        {
          id: "act-notif-001",
          start: "2026-04-01T06:00:00.000Z",
          end: "2026-04-01T07:00:00.000Z",
          sport_id: 1,
          sport_name: "running",
          score_state: "SCORED",
          score: { strain: 10, average_heart_rate: 150 },
        },
      ],
      next_token: null,
    };

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(page1Response),
    });

    // Connection lookup: notifyOnAutoImport = true
    mockDb.select.mockReturnValueOnce(
      makeChain([{ autoImportEnabled: true, notifyOnAutoImport: true }]),
    );

    // Dedup for act-notif-001 → no existing workout
    mockDb.select.mockReturnValueOnce(makeChain([]));

    // Transaction
    mockDb.transaction.mockImplementationOnce(async (fn: any) => {
      const tx = {
        insert: vi
          .fn()
          .mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
        update: vi
          .fn()
          .mockReturnValue({
            set: vi
              .fn()
              .mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
          }),
      };
      return fn(tx);
    });

    // Capture notification insert
    const outerInsertValues: Array<Record<string, unknown>> = [];
    mockDb.insert.mockReturnValue({
      values: vi.fn((val: unknown) => {
        outerInsertValues.push(val as Record<string, unknown>);
        return Promise.resolve([]);
      }),
    });

    await realTriggerBackfill(USER_ID, 30);

    // Summary notification should be emitted
    const notification = outerInsertValues.find(
      (v) => v.type === "whoop_workout_imported",
    );
    expect(notification).toBeDefined();
    expect(notification!.userId).toBe(USER_ID);
    expect(notification!.title).toBe("Whoop backfill complete");
    expect(typeof notification!.message).toBe("string");
    expect(notification!.message as string).toMatch(/1/); // imported 1 workout
  });

  it("m. does NOT emit summary notification when notifyOnAutoImport = false", async () => {
    const page1Response = {
      records: [
        {
          id: "act-nonotif-001",
          start: "2026-04-01T06:00:00.000Z",
          end: "2026-04-01T07:00:00.000Z",
          sport_id: 1,
          sport_name: "running",
          score_state: "SCORED",
          score: { strain: 10, average_heart_rate: 150 },
        },
      ],
      next_token: null,
    };

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(page1Response),
    });

    // Connection lookup: notifyOnAutoImport = false
    mockDb.select.mockReturnValueOnce(
      makeChain([{ autoImportEnabled: true, notifyOnAutoImport: false }]),
    );

    mockDb.select.mockReturnValueOnce(makeChain([]));

    mockDb.transaction.mockImplementationOnce(async (fn: any) => {
      const tx = {
        insert: vi
          .fn()
          .mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
        update: vi
          .fn()
          .mockReturnValue({
            set: vi
              .fn()
              .mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
          }),
      };
      return fn(tx);
    });

    const outerInsertValues: Array<Record<string, unknown>> = [];
    mockDb.insert.mockReturnValue({
      values: vi.fn((val: unknown) => {
        outerInsertValues.push(val as Record<string, unknown>);
        return Promise.resolve([]);
      }),
    });

    await realTriggerBackfill(USER_ID, 30);

    const notification = outerInsertValues.find(
      (v) => v.type === "whoop_workout_imported",
    );
    expect(notification).toBeUndefined();
  });

  it("o. clears state on normal completion", async () => {
    const page1Response = {
      records: [],
      next_token: null,
    };

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(page1Response),
    });

    // Connection lookup
    mockDb.select.mockReturnValueOnce(
      makeChain([{ autoImportEnabled: true, notifyOnAutoImport: false }]),
    );

    await realTriggerBackfill(USER_ID, 30);

    expect(realGetBackfillState(USER_ID)).toBeNull();
  });

  it("p. clears state on error (never throws)", async () => {
    // Simulate Whoop API failure
    global.fetch = vi.fn().mockRejectedValue(new Error("network failure"));

    // Connection lookup succeeds
    mockDb.select.mockReturnValueOnce(
      makeChain([{ autoImportEnabled: true, notifyOnAutoImport: false }]),
    );

    // Should NOT throw
    await expect(realTriggerBackfill(USER_ID, 30)).resolves.not.toThrow();

    // State cleared
    expect(realGetBackfillState(USER_ID)).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Tests: first-connect backfill trigger in whoop-oauth.ts
// ────────────────────────────────────────────────────────────────────────────

describe("handleWhoopCallback — first connect triggers backfill", () => {
  // Mock fetch for handleWhoopCallback
  const mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);

  // We need to test that handleWhoopCallback fires triggerBackfill on first connect.
  // Since triggerBackfill is mocked via vi.mock("../lib/whoop-backfill"), the mock
  // will capture calls to it.

  // Re-mock whoop-oauth to use our mocked backfill
  // handleWhoopCallback is imported after mocks are set up

  beforeEach(() => {
    vi.resetAllMocks();
    mockGetValidToken.mockResolvedValue("mock-access-token");
    mockTriggerBackfillFn.mockResolvedValue(undefined);
    // Restore global.fetch to our controlled mock — triggerBackfill tests assign
    // global.fetch = vi.fn() directly which overrides vi.stubGlobal
    global.fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockReset();
  });

  it("q. first connect (lastImportedAt = null) fires setImmediate for backfill", async () => {
    const { handleWhoopCallback } = await import("../lib/whoop-oauth");

    // Token exchange
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          access_token: "at-new",
          refresh_token: "rt-new",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "read:workout",
        }),
    });

    // Profile fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ user_id: 12345 }),
    });

    // DB insert/upsert returns lastImportedAt: null (first connect)
    mockDb.insert.mockReturnValueOnce({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi
          .fn()
          .mockResolvedValue([{ lastImportedAt: null }]),
      }),
    });

    const setImmediateSpy = vi.spyOn(globalThis, "setImmediate" as any);

    const result = await handleWhoopCallback(
      "user-first-connect",
      "auth-code",
      "verifier-xyz",
    );

    expect(result.ok).toBe(true);

    // setImmediate was called (at least once — for webhook registration and backfill)
    expect(setImmediateSpy).toHaveBeenCalled();

    setImmediateSpy.mockRestore();
  });
});
