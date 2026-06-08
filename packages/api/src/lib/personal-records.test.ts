import { describe, expect, it, vi } from "vitest";

import {
  type RecordPrArgs,
  type Tx,
  recordPr,
  recordRunningPrs,
  recordStrengthPrs,
} from "./personal-records";

const USER_ID = "00000000-0000-4000-8000-000000000101";
const EXERCISE_ID = "00000000-0000-4000-8000-000000000102";
const WORKOUT_ID = "00000000-0000-4000-8000-000000000103";
const DATE_ACHIEVED = new Date("2026-06-08T12:00:00.000Z");

type SelectRow = Record<string, unknown>;
type Operation =
  | { type: "insert"; value: Record<string, unknown> }
  | { type: "update"; value: Record<string, unknown> }
  | { type: "delete" };

function baseRecordPrArgs(
  overrides: Partial<RecordPrArgs> = {},
): RecordPrArgs {
  return {
    userId: USER_ID,
    exerciseId: EXERCISE_ID,
    recordType: "longest_distance",
    candidate: 100,
    workoutId: WORKOUT_ID,
    dateAchieved: DATE_ACHIEVED,
    ...overrides,
  };
}

function makeSelectChain(rows: SelectRow[]) {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(async () => rows),
  };

  return chain;
}

function createMockTx(selectRows: SelectRow[][]): {
  tx: Tx;
  operations: Operation[];
} {
  const operations: Operation[] = [];
  let selectIndex = 0;

  const tx = {
    select: vi.fn(() => makeSelectChain(selectRows[selectIndex++] ?? [])),
    insert: vi.fn(() => ({
      values: vi.fn(async (value: Record<string, unknown>) => {
        operations.push({ type: "insert", value });
        return [];
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((value: Record<string, unknown>) => ({
        where: vi.fn(async () => {
          operations.push({ type: "update", value });
          return [];
        }),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(async () => {
        operations.push({ type: "delete" });
        return [];
      }),
    })),
  };

  return { tx: tx as unknown as Tx, operations };
}

describe("recordPr", () => {
  it("inserts a new PR row when candidate beats no prior best", async () => {
    const { tx, operations } = createMockTx([[], []]);

    const result = await recordPr(tx, baseRecordPrArgs({ candidate: 100 }));

    expect(result).toBe(true);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      type: "insert",
      value: {
        userId: USER_ID,
        exerciseId: EXERCISE_ID,
        recordType: "longest_distance",
        value: 100,
        workoutId: WORKOUT_ID,
        previousRecordValue: null,
      },
    });
  });

  it("appends a second row when PR is broken on a different workout", async () => {
    const { tx, operations } = createMockTx([[], [{ value: 100 }]]);

    const result = await recordPr(
      tx,
      baseRecordPrArgs({
        candidate: 125,
        workoutId: "00000000-0000-4000-8000-000000000104",
      }),
    );

    expect(result).toBe(true);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      type: "insert",
      value: {
        value: 125,
        previousRecordValue: 100,
      },
    });
  });

  it("is a no-op when candidate does not beat prior best and this workout has no PR row", async () => {
    const { tx, operations } = createMockTx([[], [{ value: 100 }]]);

    const result = await recordPr(tx, baseRecordPrArgs({ candidate: 90 }));

    expect(result).toBe(false);
    expect(operations).toEqual([]);
  });

  it("deletes an existing same-workout row when an edit drops below prior best", async () => {
    const { tx, operations } = createMockTx([
      [{ id: "pr-existing" }],
      [{ value: 100 }],
    ]);

    const result = await recordPr(tx, baseRecordPrArgs({ candidate: 90 }));

    expect(result).toBe(false);
    expect(operations).toEqual([{ type: "delete" }]);
  });

  it("updates an existing same-workout row when an edit creates a new PR", async () => {
    const { tx, operations } = createMockTx([
      [{ id: "pr-existing" }],
      [{ value: 100 }],
    ]);

    const result = await recordPr(tx, baseRecordPrArgs({ candidate: 110 }));

    expect(result).toBe(true);
    expect(operations).toEqual([
      {
        type: "update",
        value: {
          userId: USER_ID,
          exerciseId: EXERCISE_ID,
          recordType: "longest_distance",
          value: 110,
          dateAchieved: DATE_ACHIEVED,
          workoutId: WORKOUT_ID,
          previousRecordValue: 100,
        },
      },
    ]);
  });

  it("treats best_pace as lower-is-better", async () => {
    const { tx, operations } = createMockTx([[], [{ value: 300 }]]);

    const result = await recordPr(
      tx,
      baseRecordPrArgs({
        recordType: "best_pace",
        candidate: 250,
      }),
    );

    expect(result).toBe(true);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      type: "insert",
      value: {
        recordType: "best_pace",
        value: 250,
        previousRecordValue: 300,
      },
    });
  });
});

describe("recordRunningPrs", () => {
  it("records longest distance and derived best pace", async () => {
    const { tx, operations } = createMockTx([
      [],
      [],
      [],
      [{ value: 320 }],
    ]);

    const result = await recordRunningPrs(tx, {
      userId: USER_ID,
      exerciseId: EXERCISE_ID,
      workoutId: WORKOUT_ID,
      dateAchieved: DATE_ACHIEVED,
      distanceMeter: 5000,
      durationMinutes: 25,
    });

    expect(result).toEqual({ longestDistance: true, bestPace: true });
    expect(operations).toHaveLength(2);
    expect(operations[0]).toMatchObject({
      type: "insert",
      value: {
        recordType: "longest_distance",
        value: 5000,
      },
    });
    expect(operations[1]).toMatchObject({
      type: "insert",
      value: {
        recordType: "best_pace",
        value: 300,
        previousRecordValue: 320,
      },
    });
  });
});

describe("recordStrengthPrs", () => {
  it("skips bodyweight max_weight and max_volume but still records max_reps", async () => {
    const { tx, operations } = createMockTx([[], [], [], [], [], []]);

    const result = await recordStrengthPrs(tx, {
      userId: USER_ID,
      exerciseId: EXERCISE_ID,
      workoutId: WORKOUT_ID,
      dateAchieved: DATE_ACHIEVED,
      sets: [{ reps: 12 }, { reps: 15 }],
    });

    expect(result).toEqual({
      maxWeight: false,
      maxReps: true,
      maxVolume: false,
    });
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      type: "insert",
      value: {
        recordType: "max_reps",
        value: 15,
      },
    });
  });

  it("records max_weight, max_reps, and max_volume for weighted sets", async () => {
    const { tx, operations } = createMockTx([[], [], [], [], [], []]);

    const result = await recordStrengthPrs(tx, {
      userId: USER_ID,
      exerciseId: EXERCISE_ID,
      workoutId: WORKOUT_ID,
      dateAchieved: DATE_ACHIEVED,
      sets: [
        { reps: 5, weight: 225 },
        { reps: 8, weight: 185 },
      ],
    });

    expect(result).toEqual({
      maxWeight: true,
      maxReps: true,
      maxVolume: true,
    });
    expect(operations.map((operation) => operation.type)).toEqual([
      "insert",
      "insert",
      "insert",
    ]);
    expect(operations[0]).toMatchObject({
      value: { recordType: "max_weight", value: 225 },
    });
    expect(operations[1]).toMatchObject({
      value: { recordType: "max_reps", value: 8 },
    });
    expect(operations[2]).toMatchObject({
      value: { recordType: "max_volume", value: 2605 },
    });
  });
});
