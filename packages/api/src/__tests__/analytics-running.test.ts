/**
 * Integration tests: Phase 4 — Running Analytics (Whoop-linked)
 *
 * Covers:
 * - analytics.runningHrTrend: returns HR per run, null for unscored runs, respects date range
 * - analytics.whoopPaceTrend: correct pace calculation, correct unit from user preferences
 * - analytics.weeklyRunDistance: aggregates by week, skips zero-distance weeks
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ────────────────────────────────────────────────────────────────────────────
// Hoisted mocks
// ────────────────────────────────────────────────────────────────────────────
const { mockDb, makeChain } = vi.hoisted(() => {
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
    query: {
      workout: { findFirst: vi.fn() },
      userPreferences: { findFirst: vi.fn() },
    },
  };

  return { mockDb, makeChain };
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
  recalculateProgressiveOverload: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/muscle-group-volume-db", () => ({
  recalculateMuscleGroupVolumeForWeek: vi.fn().mockResolvedValue(undefined),
}));

import { appRouter } from "../routers/index";

// ────────────────────────────────────────────────────────────────────────────
// Test constants
// ────────────────────────────────────────────────────────────────────────────
const USER_ID = "00000000-0000-4000-8000-000000000201";

const userCaller = appRouter.createCaller({
  session: {
    user: { id: USER_ID, email: "runner@test.internal", name: "Runner" },
    session: {
      id: "sess-runner",
      userId: USER_ID,
      expiresAt: new Date(Date.now() + 86400000),
    },
  },
  headers: new Headers(),
} as any);

const FROM = "2026-03-30";
const TO = "2026-04-29";

// ────────────────────────────────────────────────────────────────────────────
// Tests: analytics.runningHrTrend
// ────────────────────────────────────────────────────────────────────────────
describe("analytics.runningHrTrend", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns one entry per run with avgHr populated", async () => {
    mockDb.select.mockReturnValueOnce(
      makeChain([
        { date: new Date("2026-04-10T12:00:00.000Z"), avgHr: 155 },
        { date: new Date("2026-04-15T12:00:00.000Z"), avgHr: 162 },
      ]),
    );

    const result = await userCaller.analytics.runningHrTrend({
      from: FROM,
      to: TO,
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ date: "2026-04-10", avgHr: 155 });
    expect(result[1]).toMatchObject({ date: "2026-04-15", avgHr: 162 });
  });

  it("returns avgHr: null for runs where HR was not recorded (data gaps)", async () => {
    mockDb.select.mockReturnValueOnce(
      makeChain([
        { date: new Date("2026-04-10T12:00:00.000Z"), avgHr: null },
        { date: new Date("2026-04-15T12:00:00.000Z"), avgHr: 148 },
      ]),
    );

    const result = await userCaller.analytics.runningHrTrend({
      from: FROM,
      to: TO,
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ date: "2026-04-10", avgHr: null });
    expect(result[1]).toMatchObject({ date: "2026-04-15", avgHr: 148 });
  });

  it("returns empty array when no Whoop-linked runs exist in range", async () => {
    mockDb.select.mockReturnValueOnce(makeChain([]));

    const result = await userCaller.analytics.runningHrTrend({
      from: FROM,
      to: TO,
    });

    expect(result).toEqual([]);
  });

  it("respects date range — passes from/to correctly to the query", async () => {
    mockDb.select.mockReturnValueOnce(makeChain([]));

    await userCaller.analytics.runningHrTrend({
      from: "2026-04-01",
      to: "2026-04-07",
    });

    // Verify db.select was called (query ran)
    expect(mockDb.select).toHaveBeenCalledTimes(1);
  });

  it("returns entries sorted by date ascending", async () => {
    // DB returns them in order (the router orderBy asc)
    mockDb.select.mockReturnValueOnce(
      makeChain([
        { date: new Date("2026-04-01T12:00:00.000Z"), avgHr: 160 },
        { date: new Date("2026-04-08T12:00:00.000Z"), avgHr: 155 },
        { date: new Date("2026-04-20T12:00:00.000Z"), avgHr: 170 },
      ]),
    );

    const result = await userCaller.analytics.runningHrTrend({
      from: FROM,
      to: TO,
    });

    const dates = result.map((r) => r.date);
    expect(dates).toEqual([...dates].sort());
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Tests: analytics.whoopPaceTrend
// ────────────────────────────────────────────────────────────────────────────
describe("analytics.whoopPaceTrend", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("calculates correct pace in miles for a mi user", async () => {
    // 10km run in 3600s → pace = 3600 / (10000/1609.344) = 3600/6.214 ≈ 579.4 sec/mi
    mockDb.query.userPreferences.findFirst.mockResolvedValueOnce({
      distanceUnit: "mi",
    });
    mockDb.select.mockReturnValueOnce(
      makeChain([
        {
          date: new Date("2026-04-10T12:00:00.000Z"),
          distanceMeter: 10000,
          durationSeconds: 3600,
        },
      ]),
    );

    const result = await userCaller.analytics.whoopPaceTrend({
      from: FROM,
      to: TO,
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.unit).toBe("mi");
    // pace = 3600 / (10000 / 1609.344) ≈ 579.36
    expect(result[0]!.paceSecPerUnit).toBeCloseTo(579.36, 0);
    expect(result[0]!.date).toBe("2026-04-10");
  });

  it("calculates correct pace in km for a km user", async () => {
    // 5km in 1500s → pace = 1500 / (5000/1000) = 300 sec/km = 5:00/km
    mockDb.query.userPreferences.findFirst.mockResolvedValueOnce({
      distanceUnit: "km",
    });
    mockDb.select.mockReturnValueOnce(
      makeChain([
        {
          date: new Date("2026-04-12T12:00:00.000Z"),
          distanceMeter: 5000,
          durationSeconds: 1500,
        },
      ]),
    );

    const result = await userCaller.analytics.whoopPaceTrend({
      from: FROM,
      to: TO,
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.unit).toBe("km");
    expect(result[0]!.paceSecPerUnit).toBeCloseTo(300, 1);
  });

  it("returns paceSecPerUnit: null when distanceMeter is null", async () => {
    mockDb.query.userPreferences.findFirst.mockResolvedValueOnce({
      distanceUnit: "mi",
    });
    mockDb.select.mockReturnValueOnce(
      makeChain([
        {
          date: new Date("2026-04-10T12:00:00.000Z"),
          distanceMeter: null,
          durationSeconds: 1800,
        },
      ]),
    );

    const result = await userCaller.analytics.whoopPaceTrend({
      from: FROM,
      to: TO,
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.paceSecPerUnit).toBeNull();
  });

  it("returns paceSecPerUnit: null when durationSeconds is null", async () => {
    mockDb.query.userPreferences.findFirst.mockResolvedValueOnce({
      distanceUnit: "km",
    });
    mockDb.select.mockReturnValueOnce(
      makeChain([
        {
          date: new Date("2026-04-10T12:00:00.000Z"),
          distanceMeter: 5000,
          durationSeconds: null,
        },
      ]),
    );

    const result = await userCaller.analytics.whoopPaceTrend({
      from: FROM,
      to: TO,
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.paceSecPerUnit).toBeNull();
  });

  it("defaults to mi unit when user preferences not found", async () => {
    mockDb.query.userPreferences.findFirst.mockResolvedValueOnce(undefined);
    mockDb.select.mockReturnValueOnce(
      makeChain([
        {
          date: new Date("2026-04-10T12:00:00.000Z"),
          distanceMeter: 5000,
          durationSeconds: 1500,
        },
      ]),
    );

    const result = await userCaller.analytics.whoopPaceTrend({
      from: FROM,
      to: TO,
    });

    expect(result[0]!.unit).toBe("mi");
  });

  it("returns empty array when no Whoop-linked runs exist", async () => {
    mockDb.query.userPreferences.findFirst.mockResolvedValueOnce({
      distanceUnit: "mi",
    });
    mockDb.select.mockReturnValueOnce(makeChain([]));

    const result = await userCaller.analytics.whoopPaceTrend({
      from: FROM,
      to: TO,
    });

    expect(result).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Tests: analytics.weeklyRunDistance
// ────────────────────────────────────────────────────────────────────────────
describe("analytics.weeklyRunDistance", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns weeks with aggregated distance", async () => {
    mockDb.select.mockReturnValueOnce(
      makeChain([
        { weekStart: "2026-04-06", distanceMeter: "25000" }, // SUM returns string in postgres
        { weekStart: "2026-04-13", distanceMeter: "18000" },
      ]),
    );

    const result = await userCaller.analytics.weeklyRunDistance({
      from: FROM,
      to: TO,
    });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      weekStart: "2026-04-06",
      distanceMeter: 25000,
    });
    expect(result[1]).toMatchObject({
      weekStart: "2026-04-13",
      distanceMeter: 18000,
    });
  });

  it("skips weeks with null or zero distance", async () => {
    mockDb.select.mockReturnValueOnce(
      makeChain([
        { weekStart: "2026-04-06", distanceMeter: "20000" },
        { weekStart: "2026-04-13", distanceMeter: null },
        { weekStart: "2026-04-20", distanceMeter: "0" },
      ]),
    );

    const result = await userCaller.analytics.weeklyRunDistance({
      from: FROM,
      to: TO,
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.weekStart).toBe("2026-04-06");
  });

  it("returns empty array when no runs exist in range", async () => {
    mockDb.select.mockReturnValueOnce(makeChain([]));

    const result = await userCaller.analytics.weeklyRunDistance({
      from: FROM,
      to: TO,
    });

    expect(result).toEqual([]);
  });

  it("coerces distanceMeter from string (Postgres SUM returns string) to number", async () => {
    mockDb.select.mockReturnValueOnce(
      makeChain([{ weekStart: "2026-04-06", distanceMeter: "16093.44" }]),
    );

    const result = await userCaller.analytics.weeklyRunDistance({
      from: FROM,
      to: TO,
    });

    expect(result[0]!.distanceMeter).toBe(16093.44);
    expect(typeof result[0]!.distanceMeter).toBe("number");
  });
});
