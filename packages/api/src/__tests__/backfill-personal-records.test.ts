/**
 * Integration tests: KOI-80 — admin.backfillPersonalRecords
 *
 * Reprocesses every existing workout (oldest-first per user) to populate the
 * personal_record table from scratch, reusing the live recordRunningPrs /
 * recordStrengthPrs functions. Covers:
 *  - 10 workouts oldest-first → correct progression chain (previousRecordValue)
 *  - running vs strength dispatch (cardioSubtype === "running" / distanceMeter)
 *  - a no-qualifying-data workout: counted in `processed`, records nothing
 *  - prsRecorded matches rows actually inserted/updated to a new PR
 *  - idempotency: re-running yields identical rows + identical tally
 *
 * Rather than the call-order `mockReturnValueOnce` style, this builds a faithful
 * in-memory drizzle-ish `tx` that the real personal-records functions drive.
 * That lets the prior-best reads see rows written by earlier workouts, so the
 * progression chain is exercised for real.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  exercise,
  exerciseLog,
  exerciseSet,
  personalRecord,
  workout,
} from "@life-tracker/db/schema/index";

// ────────────────────────────────────────────────────────────────────────────
// Hoisted mock db (must run before importing the router)
// ────────────────────────────────────────────────────────────────────────────
const { mockDb } = vi.hoisted(() => {
  const mockDb = {
    transaction: vi.fn(),
  };
  return { mockDb };
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

// Mock drizzle-orm query helpers so predicates are inspectable row-test
// functions / sort descriptors. Keep every real export (pgTable, relations,
// sql, …) via importOriginal so schema construction still works. Declared
// before importing the router so the (hoisted) mock is in place for the graph.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();

  // Drizzle columns expose `.name` (snake_case); map to the camelCase row keys
  // our in-memory store uses.
  const colKey = (col: any): string => {
    const name: string = col?.name ?? "";
    const map: Record<string, string> = {
      user_id: "userId",
      exercise_id: "exerciseId",
      record_type: "recordType",
      workout_id: "workoutId",
      exercise_log_id: "exerciseLogId",
      date: "date",
      value: "value",
      reps: "reps",
      weight: "weight",
      id: "id",
    };
    return map[name] ?? name;
  };

  return {
    ...actual,
    eq: (col: any, val: any) => (row: any) => row[colKey(col)] === val,
    ne: (col: any, val: any) => (row: any) => row[colKey(col)] !== val,
    isNull: (col: any) => (row: any) => row[colKey(col)] == null,
    and:
      (...preds: any[]) =>
      (row: any) =>
        preds.every((p) => (p ? p(row) : true)),
    or:
      (...preds: any[]) =>
      (row: any) =>
        preds.some((p) => (p ? p(row) : false)),
    asc: (col: any) => ({ key: colKey(col), dir: "asc" }),
    desc: (col: any) => ({ key: colKey(col), dir: "desc" }),
  };
});

import { appRouter } from "../routers/index";

// ────────────────────────────────────────────────────────────────────────────
// In-memory fixture store
// ────────────────────────────────────────────────────────────────────────────
type WorkoutRow = { id: string; userId: string; date: Date };
type ExerciseRow = { id: string; cardioSubtype: string | null };
type LogRow = {
  id: string;
  workoutId: string;
  exerciseId: string | null;
  distanceMeter: number | null;
  durationMinutes: number | null;
};
type SetRow = {
  id: string;
  exerciseLogId: string;
  reps: number | null;
  weight: number | null;
};
type PrRow = {
  id: string;
  userId: string;
  exerciseId: string | null;
  recordType: string;
  value: number;
  dateAchieved: Date;
  workoutId: string | null;
  previousRecordValue: number | null;
};

type Store = {
  workouts: WorkoutRow[];
  exercises: ExerciseRow[];
  logs: LogRow[];
  sets: SetRow[];
  prs: PrRow[];
};

// The personal-records module and admin router import query helpers
// ({ and, asc, desc, eq, isNull, ne, or }) from "drizzle-orm". We mock those
// helpers (only) to produce inspectable row-test functions while keeping every
// other real export (pgTable, relations, sql, …) via importActual, so schema
// construction still works. See the vi.mock("drizzle-orm") block below.

// ────────────────────────────────────────────────────────────────────────────
// Test constants
// ────────────────────────────────────────────────────────────────────────────
const ADMIN_ID = "00000000-0000-4000-8000-0000000000a1";
const USER_A = "00000000-0000-4000-8000-0000000000b1";
const USER_B = "00000000-0000-4000-8000-0000000000b2";
const STRENGTH_EX = "00000000-0000-4000-8000-0000000000c1";
const RUN_EX = "00000000-0000-4000-8000-0000000000c2";

const adminCaller = appRouter.createCaller({
  session: {
    user: { id: ADMIN_ID, email: "admin@test.internal", name: "Admin" },
    session: {
      id: "sess-admin",
      userId: ADMIN_ID,
      expiresAt: new Date(Date.now() + 86400000),
    },
  },
  headers: new Headers(),
} as any);

const userCaller = appRouter.createCaller({
  session: {
    user: { id: USER_A, email: "user@test.internal", name: "User" },
    session: {
      id: "sess-user",
      userId: USER_A,
      expiresAt: new Date(Date.now() + 86400000),
    },
  },
  headers: new Headers(),
} as any);

// ────────────────────────────────────────────────────────────────────────────
// In-memory tx implementation (real predicate evaluation)
// ────────────────────────────────────────────────────────────────────────────
let uuidCounter = 0;

/**
 * A query builder that resolves against the in-memory store. We special-case the
 * exact shapes used by the code under test based on the table passed to
 * `.from()` / `.insert()` / `.update()` / `.delete()` and the predicate factory
 * recorded by `.where()`. Predicates are evaluated by the mocked drizzle helpers
 * which return row-test functions (see vi.mock("drizzle-orm")).
 */
function buildTx(store: Store) {
  function selectBuilder(projection: Record<string, unknown>) {
    let table: unknown;
    let joinTable: unknown;
    let predicate: ((row: any) => boolean) | null = null;
    let orderBy: { key: string; dir: "asc" | "desc" }[] = [];
    let limit: number | null = null;

    const builder: any = {
      from(t: unknown) {
        table = t;
        return builder;
      },
      leftJoin(t: unknown, _on: unknown) {
        // We model the only join used (exerciseLog → exercise) by FK below.
        joinTable = t;
        return builder;
      },
      where(p: any) {
        predicate = p;
        return builder;
      },
      orderBy(...os: any[]) {
        orderBy = os;
        return builder;
      },
      limit(n: number) {
        limit = n;
        return builder;
      },
      then(resolve: (rows: any[]) => any, reject?: any) {
        return Promise.resolve(execute()).then(resolve, reject);
      },
    };

    function execute(): any[] {
      let rows: any[] = [];

      if (table === workout) {
        rows = store.workouts.map((w) => ({ ...w }));
      } else if (table === exerciseLog) {
        const joiningExercise = joinTable === exercise;
        rows = store.logs
          .filter((l) => (predicate ? predicate(l) : true))
          .map((l) => {
            // leftJoin exercise ON exerciseLog.exerciseId = exercise.id
            const ex = joiningExercise
              ? store.exercises.find((e) => e.id === l.exerciseId)
              : undefined;
            return {
              id: l.id,
              exerciseId: l.exerciseId,
              distanceMeter: l.distanceMeter,
              durationMinutes: l.durationMinutes,
              cardioSubtype: ex ? ex.cardioSubtype : null,
            };
          });
        // join + predicate already applied
        predicate = null;
      } else if (table === exerciseSet) {
        rows = store.sets
          .filter((s) => (predicate ? predicate(s) : true))
          .map((s) => ({ reps: s.reps, weight: s.weight }));
        predicate = null;
      } else if (table === personalRecord) {
        rows = store.prs.map((p) => ({ ...p }));
      }

      if (predicate) {
        rows = rows.filter((r) => predicate!(r));
      }

      if (orderBy.length > 0) {
        rows = [...rows].sort((a, b) => {
          for (const o of orderBy) {
            const av = a[o.key];
            const bv = b[o.key];
            const cmp =
              av instanceof Date && bv instanceof Date
                ? av.getTime() - bv.getTime()
                : av < bv
                  ? -1
                  : av > bv
                    ? 1
                    : 0;
            if (cmp !== 0) return o.dir === "asc" ? cmp : -cmp;
          }
          return 0;
        });
      }

      if (limit != null) rows = rows.slice(0, limit);

      // Project to the requested columns when projection is provided.
      if (projection && Object.keys(projection).length > 0) {
        return rows.map((r) => {
          const out: Record<string, unknown> = {};
          for (const key of Object.keys(projection)) {
            out[key] = r[key];
          }
          return out;
        });
      }
      return rows;
    }

    return builder;
  }

  const tx: any = {
    select(projection: Record<string, unknown>) {
      return selectBuilder(projection ?? {});
    },
    insert(table: unknown) {
      return {
        values(value: any) {
          if (table === personalRecord) {
            store.prs.push({ ...value });
          }
          return Promise.resolve([]);
        },
      };
    },
    update(table: unknown) {
      return {
        set(value: any) {
          return {
            where(predicate: (row: any) => boolean) {
              if (table === personalRecord) {
                for (const row of store.prs) {
                  if (predicate(row)) Object.assign(row, value);
                }
              }
              return Promise.resolve([]);
            },
          };
        },
      };
    },
    delete(table: unknown) {
      return {
        where(predicate: (row: any) => boolean) {
          if (table === personalRecord) {
            store.prs = store.prs.filter((row) => !predicate(row));
          }
          return Promise.resolve([]);
        },
      };
    },
  };

  return tx;
}

// ────────────────────────────────────────────────────────────────────────────
// Store helpers
// ────────────────────────────────────────────────────────────────────────────
function newStore(): Store {
  return { workouts: [], exercises: [], logs: [], sets: [], prs: [] };
}

function addStrengthWorkout(
  store: Store,
  userId: string,
  date: Date,
  weight: number,
  reps: number,
): string {
  const wId = `w-${uuidCounter++}`;
  const lId = `l-${uuidCounter++}`;
  store.workouts.push({ id: wId, userId, date });
  store.logs.push({
    id: lId,
    workoutId: wId,
    exerciseId: STRENGTH_EX,
    distanceMeter: null,
    durationMinutes: null,
  });
  store.sets.push({
    id: `s-${uuidCounter++}`,
    exerciseLogId: lId,
    reps,
    weight,
  });
  return wId;
}

function addRunWorkout(
  store: Store,
  userId: string,
  date: Date,
  distanceMeter: number,
  durationMinutes: number,
): string {
  const wId = `w-${uuidCounter++}`;
  store.workouts.push({ id: wId, userId, date });
  store.logs.push({
    id: `l-${uuidCounter++}`,
    workoutId: wId,
    exerciseId: RUN_EX,
    distanceMeter,
    durationMinutes,
  });
  return wId;
}

function addEmptyWorkout(store: Store, userId: string, date: Date): string {
  const wId = `w-${uuidCounter++}`;
  store.workouts.push({ id: wId, userId, date });
  // A log with no exerciseId → skipped, no PRs.
  store.logs.push({
    id: `l-${uuidCounter++}`,
    workoutId: wId,
    exerciseId: null,
    distanceMeter: null,
    durationMinutes: null,
  });
  return wId;
}

function seedExercises(store: Store) {
  store.exercises.push({ id: STRENGTH_EX, cardioSubtype: null });
  store.exercises.push({ id: RUN_EX, cardioSubtype: "running" });
}

let store: Store;

beforeEach(() => {
  vi.clearAllMocks();
  uuidCounter = 0;
  store = newStore();
  seedExercises(store);
  mockDb.transaction.mockImplementation(async (fn: any) => fn(buildTx(store)));
});

// ────────────────────────────────────────────────────────────────────────────
describe("admin.backfillPersonalRecords (KOI-80)", () => {
  it("requires admin access (FORBIDDEN for non-admins)", async () => {
    await expect(userCaller.admin.backfillPersonalRecords()).rejects.toThrow(
      /Admin access required/,
    );
  });

  it("builds a correct progression chain across 10 strength workouts, oldest-first", async () => {
    // Insert in NON-chronological order to prove the proc sorts oldest-first.
    const weights = [60, 65, 70, 75, 80, 85, 90, 95, 100, 105];
    // shuffle insert order
    const order = [4, 0, 9, 2, 7, 1, 5, 8, 3, 6];
    const day = (n: number) => new Date(2026, 0, n + 1);
    for (const idx of order) {
      addStrengthWorkout(store, USER_A, day(idx), weights[idx]!, 5);
    }

    const result = await adminCaller.admin.backfillPersonalRecords();

    expect(result.processed).toBe(10);

    // Each strictly-increasing-weight workout sets a new max_weight PR.
    const maxWeightPrs = store.prs
      .filter((p) => p.recordType === "max_weight")
      .sort((a, b) => a.value - b.value);
    expect(maxWeightPrs.map((p) => p.value)).toEqual(weights);

    // previousRecordValue chains the prior best: first is null, then 60, 65, ...
    expect(maxWeightPrs[0]!.previousRecordValue).toBeNull();
    for (let i = 1; i < weights.length; i++) {
      expect(maxWeightPrs[i]!.previousRecordValue).toBe(weights[i - 1]);
    }

    // reps are constant (5) so only the FIRST workout records a max_reps PR.
    const maxRepsPrs = store.prs.filter((p) => p.recordType === "max_reps");
    expect(maxRepsPrs).toHaveLength(1);
    expect(maxRepsPrs[0]!.value).toBe(5);
    expect(maxRepsPrs[0]!.previousRecordValue).toBeNull();
  });

  it("is idempotent: re-running leaves rows identical and records nothing new", async () => {
    addStrengthWorkout(store, USER_A, new Date(2026, 0, 1), 60, 5);
    addStrengthWorkout(store, USER_A, new Date(2026, 0, 2), 80, 8);
    addRunWorkout(store, USER_A, new Date(2026, 0, 3), 5000, 25);
    addRunWorkout(store, USER_A, new Date(2026, 0, 4), 10000, 60);

    const snapshotOf = () =>
      JSON.stringify(
        [...store.prs]
          .map((p) => ({ ...p, id: "x" }))
          .sort((a, b) =>
            `${a.workoutId}${a.recordType}`.localeCompare(
              `${b.workoutId}${b.recordType}`,
            ),
          ),
      );

    const first = await adminCaller.admin.backfillPersonalRecords();
    const snapshot = snapshotOf();
    const countAfterFirst = store.prs.length;

    const second = await adminCaller.admin.backfillPersonalRecords();

    // Same workouts iterated, but nothing new recorded — the (workout,exercise)
    // pairs already have PR rows so they are skipped on the re-run.
    expect(second.processed).toBe(first.processed);
    expect(second.prsRecorded).toBe(0);

    // Row set is byte-for-byte identical: no superseded historical rows culled.
    expect(store.prs.length).toBe(countAfterFirst);
    expect(snapshotOf()).toBe(snapshot);
  });

  it("dispatches running vs strength correctly", async () => {
    addStrengthWorkout(store, USER_A, new Date(2026, 0, 1), 100, 5);
    addRunWorkout(store, USER_A, new Date(2026, 0, 2), 5000, 30);

    await adminCaller.admin.backfillPersonalRecords();

    const types = new Set(store.prs.map((p) => p.recordType));
    // strength exercise → max_weight/max_reps/max_volume
    expect(types.has("max_weight")).toBe(true);
    expect(types.has("max_reps")).toBe(true);
    expect(types.has("max_volume")).toBe(true);
    // running exercise → longest_distance/best_pace
    expect(types.has("longest_distance")).toBe(true);
    expect(types.has("best_pace")).toBe(true);

    // All strength PRs reference the strength exercise; all running PRs the run.
    for (const pr of store.prs) {
      if (["max_weight", "max_reps", "max_volume"].includes(pr.recordType)) {
        expect(pr.exerciseId).toBe(STRENGTH_EX);
      } else {
        expect(pr.exerciseId).toBe(RUN_EX);
      }
    }
  });

  it("treats a log with distanceMeter as running even without cardioSubtype", async () => {
    // exerciseId points to a strength exercise (cardioSubtype null) but the log
    // carries a distanceMeter → backfill must dispatch to recordRunningPrs.
    const wId = `w-${uuidCounter++}`;
    store.workouts.push({
      id: wId,
      userId: USER_A,
      date: new Date(2026, 0, 1),
    });
    store.logs.push({
      id: `l-${uuidCounter++}`,
      workoutId: wId,
      exerciseId: STRENGTH_EX,
      distanceMeter: 4000,
      durationMinutes: 20,
    });

    await adminCaller.admin.backfillPersonalRecords();

    const types = store.prs.map((p) => p.recordType);
    expect(types).toContain("longest_distance");
    expect(types).toContain("best_pace");
    // No strength PRs because we dispatched to running.
    expect(types).not.toContain("max_weight");
  });

  it("counts a no-qualifying-data workout in processed but records nothing", async () => {
    addStrengthWorkout(store, USER_A, new Date(2026, 0, 1), 100, 5);
    addEmptyWorkout(store, USER_A, new Date(2026, 0, 2)); // log has null exerciseId

    const result = await adminCaller.admin.backfillPersonalRecords();

    expect(result.processed).toBe(2);
    // Only the strength workout produced PRs (3: weight/reps/volume).
    expect(store.prs).toHaveLength(3);
    // No PR row references the empty workout.
    const emptyWorkoutId = store.workouts[1]!.id;
    expect(store.prs.some((p) => p.workoutId === emptyWorkoutId)).toBe(false);
  });

  it("prsRecorded tally matches rows actually inserted/updated to a new PR", async () => {
    // w1: 60kg x5 → max_weight, max_reps, max_volume all new = 3
    // w2: 50kg x5 → nothing new (lighter, same reps, lower volume) = 0
    // w3: 70kg x5 → max_weight + max_volume new (reps tie) = 2
    addStrengthWorkout(store, USER_A, new Date(2026, 0, 1), 60, 5);
    addStrengthWorkout(store, USER_A, new Date(2026, 0, 2), 50, 5);
    addStrengthWorkout(store, USER_A, new Date(2026, 0, 3), 70, 5);

    const result = await adminCaller.admin.backfillPersonalRecords();

    expect(result.processed).toBe(3);
    expect(result.prsRecorded).toBe(5);
    // Tally equals the number of PR rows actually persisted.
    expect(store.prs).toHaveLength(5);
  });

  it("processes multiple users independently, each oldest-first", async () => {
    addStrengthWorkout(store, USER_B, new Date(2026, 0, 2), 200, 3);
    addStrengthWorkout(store, USER_A, new Date(2026, 0, 1), 60, 5);
    addStrengthWorkout(store, USER_A, new Date(2026, 0, 2), 80, 5);

    const result = await adminCaller.admin.backfillPersonalRecords();

    expect(result.processed).toBe(3);

    const userAMaxWeight = store.prs
      .filter((p) => p.userId === USER_A && p.recordType === "max_weight")
      .sort((a, b) => a.value - b.value);
    expect(userAMaxWeight.map((p) => p.value)).toEqual([60, 80]);
    expect(userAMaxWeight[0]!.previousRecordValue).toBeNull();
    expect(userAMaxWeight[1]!.previousRecordValue).toBe(60);

    const userBMaxWeight = store.prs.filter(
      (p) => p.userId === USER_B && p.recordType === "max_weight",
    );
    expect(userBMaxWeight).toHaveLength(1);
    expect(userBMaxWeight[0]!.previousRecordValue).toBeNull();
  });
});
