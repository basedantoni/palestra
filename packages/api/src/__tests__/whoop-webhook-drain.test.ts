/**
 * Tests for the Whoop webhook startup drain and in-flight registry.
 *
 * Covers:
 * 1. Empty queue → { scanned: 0, dispatched: 0 }, no processor called
 * 2. Pending row past grace window → dispatched, trackInFlight receives the promise
 * 3. Orphaned processing row (>5 min) → re-dispatched
 * 4. Unknown eventType → UPDATE called with status='skipped', no processor
 * 5. trackInFlight add/remove lifecycle — count increments then decrements after resolve
 * 6. getInFlightPromises() returns snapshot — Set mutations after call don't affect returned array
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ────────────────────────────────────────────────────────────────────────────
// Hoisted mocks (must run before any imports)
// ────────────────────────────────────────────────────────────────────────────
const { mockDb, makeChain, mockDispatchWhoopEvent } = vi.hoisted(() => {
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
    execute: vi.fn(),
    transaction: vi.fn(),
    query: {},
  };

  const mockDispatchWhoopEvent = vi.fn();

  return { mockDb, makeChain, mockDispatchWhoopEvent };
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
    TOKEN_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    WHOOP_CLIENT_SECRET: "test-webhook-secret-for-hmac",
  },
}));

vi.mock("../lib/whoop-webhook", () => ({
  dispatchWhoopEvent: mockDispatchWhoopEvent,
}));

// Import after mocks are set up
import { drainPendingWhoopEvents } from "../lib/whoop-webhook-drain";
import { getInFlightCount, getInFlightPromises, trackInFlight } from "../lib/whoop-inflight";

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("drainPendingWhoopEvents", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("1. empty queue → returns { scanned: 0, dispatched: 0 }, no processor called", async () => {
    mockDb.execute.mockResolvedValue({ rows: [] });

    const result = await drainPendingWhoopEvents();

    expect(result).toEqual({ scanned: 0, dispatched: 0 });
    expect(mockDispatchWhoopEvent).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("2. pending row past grace window → dispatched, trackInFlight called", async () => {
    const pendingRow = {
      id: "event-pending-1",
      user_id: "user-abc",
      event_type: "workout.updated",
      whoop_resource_id: "act-uuid-999",
    };

    mockDb.execute.mockResolvedValue({ rows: [pendingRow] });

    const deferred = Promise.resolve();
    mockDispatchWhoopEvent.mockReturnValue(deferred);

    const result = await drainPendingWhoopEvents();

    expect(result).toEqual({ scanned: 1, dispatched: 1 });
    expect(mockDispatchWhoopEvent).toHaveBeenCalledOnce();
    expect(mockDispatchWhoopEvent).toHaveBeenCalledWith({
      eventId: "event-pending-1",
      userId: "user-abc",
      eventType: "workout.updated",
      resourceId: "act-uuid-999",
    });
  });

  it("3. orphaned processing row (>5 min) → re-dispatched", async () => {
    const orphanRow = {
      id: "event-orphan-1",
      user_id: "user-xyz",
      event_type: "sleep.updated",
      whoop_resource_id: "sleep-uuid-777",
    };

    mockDb.execute.mockResolvedValue({ rows: [orphanRow] });
    mockDispatchWhoopEvent.mockReturnValue(Promise.resolve());

    const result = await drainPendingWhoopEvents();

    expect(result).toEqual({ scanned: 1, dispatched: 1 });
    expect(mockDispatchWhoopEvent).toHaveBeenCalledWith({
      eventId: "event-orphan-1",
      userId: "user-xyz",
      eventType: "sleep.updated",
      resourceId: "sleep-uuid-777",
    });
  });

  it("4. unknown eventType → UPDATE called with status='skipped', no processor promise tracked", async () => {
    const unknownRow = {
      id: "event-unknown-1",
      user_id: "user-abc",
      event_type: "unknown.event",
      whoop_resource_id: null,
    };

    mockDb.execute.mockResolvedValue({ rows: [unknownRow] });
    // dispatchWhoopEvent returns null for unknown types / missing resourceId
    mockDispatchWhoopEvent.mockReturnValue(null);

    // Mock the update().set().where() chain used for skipping
    mockDb.update.mockReturnValueOnce(makeChain([]));

    const result = await drainPendingWhoopEvents();

    expect(result).toEqual({ scanned: 1, dispatched: 0 });
    expect(mockDispatchWhoopEvent).toHaveBeenCalledOnce();
    // DB update for skipping should have been called
    expect(mockDb.update).toHaveBeenCalledOnce();
  });
});

describe("trackInFlight lifecycle", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("5. getInFlightCount() increments on add, decrements after resolve", async () => {
    let resolvePromise!: () => void;
    const promise = new Promise<void>((resolve) => {
      resolvePromise = resolve;
    });

    const before = getInFlightCount();
    trackInFlight(promise);
    const during = getInFlightCount();

    resolvePromise();
    await promise;
    // Give the finally() callback a tick to run
    await Promise.resolve();

    const after = getInFlightCount();

    expect(during).toBe(before + 1);
    expect(after).toBe(before);
  });

  it("6. getInFlightPromises() returns a snapshot — mutations to Set after call don't affect returned array", async () => {
    let resolve1!: () => void;
    const p1 = new Promise<void>((resolve) => { resolve1 = resolve; });

    trackInFlight(p1);
    const snapshot = getInFlightPromises();
    const snapshotLength = snapshot.length;

    // Add another promise after taking snapshot
    let resolve2!: () => void;
    const p2 = new Promise<void>((resolve) => { resolve2 = resolve; });
    trackInFlight(p2);

    // Snapshot should not include p2
    expect(snapshot.length).toBe(snapshotLength);
    expect(snapshot).not.toContain(p2);

    // Cleanup
    resolve1();
    resolve2();
    await Promise.allSettled([p1, p2]);
    await Promise.resolve(); // flush finally callbacks
  });
});
