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
import { fingerprintTcxRun, type ParsedTcxRun } from "../lib/tcx-import";

const USER_ID = "00000000-0000-4000-8000-000000000301";
const SHORT_RUN_ID = "00000000-0000-4000-8000-000000000302";
const LONG_RUN_ID = "00000000-0000-4000-8000-000000000303";

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

const runningExerciseRows = [
  { id: SHORT_RUN_ID, name: "Short Run" },
  { id: LONG_RUN_ID, name: "Long Run" },
];

const shortRun: ParsedTcxRun = {
  fileName: "short.tcx",
  startedAt: "2026-01-01T12:00:00.000Z",
  durationSeconds: 1800,
  distanceMeter: 5000.4,
  calories: 300,
  avgHeartRate: 140,
  maxHeartRate: 170,
};

const longRun: ParsedTcxRun = {
  fileName: "long.tcx",
  startedAt: "2026-01-02T12:00:00.000Z",
  durationSeconds: 3600,
  distanceMeter: 10000,
  calories: 700,
  avgHeartRate: 150,
  maxHeartRate: 180,
};

const duplicateRun: ParsedTcxRun = {
  fileName: "duplicate-a.tcx",
  startedAt: "2022-10-29T19:05:05.526Z",
  durationSeconds: 6001,
  distanceMeter: 14920.372,
  calories: 1146,
  avgHeartRate: 147,
  maxHeartRate: 165,
};

const duplicateRunSameRequest: ParsedTcxRun = {
  ...duplicateRun,
  fileName: "duplicate-b.tcx",
  distanceMeter: 14924.9,
  calories: null,
};

describe("tcxImport router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.transaction.mockImplementation(async (fn: any) => fn(mockTx));
  });

  it("previews DB duplicates and repeated files in the same request", async () => {
    mockDb.select
      .mockReturnValueOnce(makeChain(runningExerciseRows))
      .mockReturnValueOnce(
        makeChain([
          {
            date: new Date(duplicateRun.startedAt),
            distanceMeter: duplicateRun.distanceMeter,
          },
        ]),
      );

    const result = await userCaller.tcxImport.preview({
      runs: [shortRun, duplicateRun, duplicateRunSameRequest],
    });

    expect(result.source).toBe("nike_run_club");
    expect(result.totalCount).toBe(3);
    expect(result.duplicateCount).toBe(2);
    expect(result.newCount).toBe(1);
    expect(result.skippedInvalidCount).toBe(0);
    expect(result.runs).toEqual([
      expect.objectContaining({
        fileName: "short.tcx",
        isDuplicate: false,
        exerciseName: "Short Run",
      }),
      expect.objectContaining({
        fileName: "duplicate-a.tcx",
        isDuplicate: true,
        exerciseName: "Long Run",
      }),
      expect.objectContaining({
        fileName: "duplicate-b.tcx",
        isDuplicate: true,
        exerciseName: "Long Run",
      }),
    ]);
  });

  it("commits new TCX runs as cardio workouts and exercise logs", async () => {
    const insertedValues: unknown[] = [];
    mockDb.select
      .mockReturnValueOnce(makeChain(runningExerciseRows))
      .mockReturnValueOnce(makeChain([]));
    mockTx.insert.mockReturnValue(makeChain([], (value) => insertedValues.push(value)));

    const result = await userCaller.tcxImport.commit({
      runs: [shortRun],
    });

    expect(result).toEqual({
      createdCount: 1,
      skippedDuplicateCount: 0,
      skippedInvalidCount: 0,
      totalCount: 1,
    });
    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(mockTx.insert).toHaveBeenCalledTimes(2);
    expect(insertedValues[0]).toMatchObject({
      userId: USER_ID,
      date: new Date(shortRun.startedAt),
      workoutType: "cardio",
      durationMinutes: 30,
      source: "nike_run_club",
    });
    expect(insertedValues[0]).toMatchObject({
      notes: expect.stringContaining("Imported from TCX (nike_run_club)"),
    });
    expect(insertedValues[1]).toMatchObject({
      exerciseId: SHORT_RUN_ID,
      exerciseName: "Short Run",
      order: 0,
      distanceMeter: shortRun.distanceMeter,
      durationSeconds: shortRun.durationSeconds,
      durationMinutes: 30,
      heartRate: shortRun.avgHeartRate,
    });
    expect(recalculateProgressiveOverload).toHaveBeenCalledWith(USER_ID, [
      SHORT_RUN_ID,
    ]);
    expect(recalculateMuscleGroupVolumeForWeek).toHaveBeenCalledTimes(1);
  });

  it("maps runs under 8km to Short Run and 8km or longer to Long Run", async () => {
    const insertedValues: unknown[] = [];
    mockDb.select
      .mockReturnValueOnce(makeChain(runningExerciseRows))
      .mockReturnValueOnce(makeChain([]));
    mockTx.insert.mockReturnValue(makeChain([], (value) => insertedValues.push(value)));

    await userCaller.tcxImport.commit({
      runs: [shortRun, longRun],
    });

    expect(insertedValues[1]).toMatchObject({
      exerciseId: SHORT_RUN_ID,
      exerciseName: "Short Run",
    });
    expect(insertedValues[3]).toMatchObject({
      exerciseId: LONG_RUN_ID,
      exerciseName: "Long Run",
    });
  });

  it("skips already-imported TCX runs on rerun without opening a transaction", async () => {
    mockDb.select
      .mockReturnValueOnce(makeChain(runningExerciseRows))
      .mockReturnValueOnce(
        makeChain([
          {
            date: new Date(shortRun.startedAt),
            distanceMeter: shortRun.distanceMeter,
          },
          {
            date: new Date(longRun.startedAt),
            distanceMeter: longRun.distanceMeter,
          },
        ]),
      );

    const result = await userCaller.tcxImport.commit({
      runs: [shortRun, longRun],
    });

    expect(result).toEqual({
      createdCount: 0,
      skippedDuplicateCount: 2,
      skippedInvalidCount: 0,
      totalCount: 2,
    });
    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(mockTx.insert).not.toHaveBeenCalled();
  });

  it("commits only selected fingerprints when provided", async () => {
    const insertedValues: unknown[] = [];
    mockDb.select
      .mockReturnValueOnce(makeChain(runningExerciseRows))
      .mockReturnValueOnce(makeChain([]));
    mockTx.insert.mockReturnValue(makeChain([], (value) => insertedValues.push(value)));

    const result = await userCaller.tcxImport.commit({
      runs: [shortRun, longRun],
      selectedFingerprints: [
        fingerprintTcxRun(longRun.startedAt, longRun.distanceMeter),
      ],
    });

    expect(result.createdCount).toBe(1);
    expect(result.totalCount).toBe(1);
    expect(insertedValues[1]).toMatchObject({
      exerciseId: LONG_RUN_ID,
      exerciseName: "Long Run",
    });
  });
});
