/**
 * Tests for the durable recalc queue (enqueue / dispatch / drain).
 *
 * Covers:
 * 1. both-kinds enqueue — exerciseIds + weekDates → progressive_overload + muscle_group_volume rows
 * 2. date-only enqueue — weekDates only → muscle_group_volume row, no PO row
 * 3. success dispatch — claim wins, recalc runs, row marked done
 * 4. failure dispatch — recalc throws → row marked failed, promise still resolves (no unhandled rejection)
 * 5. claim race no-op — claim loses (rowCount 0) → recalc never runs, no done/failed write
 * 6. drain dispatches claimed rows — CTE-claimed rows run their recalc and are marked done
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ────────────────────────────────────────────────────────────────────────────
// Hoisted mocks (must run before any imports)
// ────────────────────────────────────────────────────────────────────────────
const { mockDb, makeChain, mockRecalcPO, mockRecalcMGV } = vi.hoisted(() => {
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

  const mockRecalcPO = vi.fn();
  const mockRecalcMGV = vi.fn();

  return { mockDb, makeChain, mockRecalcPO, mockRecalcMGV };
});

vi.mock("@life-tracker/db", () => ({ db: mockDb }));
vi.mock("../lib/progressive-overload-db", () => ({
  recalculateProgressiveOverload: mockRecalcPO,
}));
vi.mock("../lib/muscle-group-volume-db", () => ({
  recalculateMuscleGroupVolumeForWeek: mockRecalcMGV,
}));

// Import after mocks are set up
import {
  dispatchRecalcJob,
  drainPendingRecalcJobs,
  enqueueRecalcs,
} from "../lib/recalc-queue";
import { getInFlightPromises } from "../lib/whoop-inflight";

// ────────────────────────────────────────────────────────────────────────────
// Test harness — captured insert rows + update set() payloads
// ────────────────────────────────────────────────────────────────────────────
let capturedInsertRows: any[];
let updateSets: any[];
let claimResolve: { rowCount: number };

async function flushInFlight() {
  await Promise.allSettled(getInFlightPromises());
  // give finally() callbacks a tick to deregister
  await Promise.resolve();
}

beforeEach(() => {
  vi.resetAllMocks();
  capturedInsertRows = [];
  updateSets = [];
  claimResolve = { rowCount: 1 };

  mockDb.insert.mockImplementation(() => ({
    values: (rows: any[]) => {
      capturedInsertRows = rows;
      return {
        returning: () =>
          Promise.resolve(rows.map((r, i) => ({ ...r, id: `job-${i}` }))),
      };
    },
  }));

  mockDb.update.mockImplementation(() => ({
    set: (vals: any) => {
      updateSets.push(vals);
      // First update per dispatch is the atomic claim (its rowCount decides
      // whether work proceeds); later updates (done/failed) ignore rowCount.
      return makeChain(claimResolve);
    },
  }));

  mockRecalcPO.mockResolvedValue(undefined);
  mockRecalcMGV.mockResolvedValue(undefined);
});

// ────────────────────────────────────────────────────────────────────────────
// enqueueRecalcs
// ────────────────────────────────────────────────────────────────────────────

describe("enqueueRecalcs", () => {
  it("1. both kinds — exerciseIds + weekDates insert PO and MGV rows", async () => {
    await enqueueRecalcs("user-1", {
      exerciseIds: ["ex-1", "ex-2", "ex-1"],
      weekDates: [new Date("2025-01-08T12:00:00.000Z")],
    });

    expect(capturedInsertRows).toHaveLength(2);
    expect(capturedInsertRows.map((r) => r.kind).sort()).toEqual([
      "muscle_group_volume",
      "progressive_overload",
    ]);

    const po = capturedInsertRows.find(
      (r) => r.kind === "progressive_overload",
    );
    expect(po.userId).toBe("user-1");
    // dedups exercise ids
    expect(po.payload).toEqual({ exerciseIds: ["ex-1", "ex-2"] });

    const mgv = capturedInsertRows.find(
      (r) => r.kind === "muscle_group_volume",
    );
    expect(mgv.payload).toEqual({
      weekOf: "2025-01-08T12:00:00.000Z",
    });

    await flushInFlight();
  });

  it("2. date-only — weekDates without exerciseIds insert only MGV row", async () => {
    await enqueueRecalcs("user-1", {
      weekDates: [
        new Date("2025-01-08T00:00:00.000Z"),
        // same ISO week → deduped to a single MGV job
        new Date("2025-01-10T00:00:00.000Z"),
      ],
    });

    expect(capturedInsertRows).toHaveLength(1);
    expect(capturedInsertRows[0].kind).toBe("muscle_group_volume");

    await flushInFlight();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// dispatchRecalcJob
// ────────────────────────────────────────────────────────────────────────────

describe("dispatchRecalcJob", () => {
  it("3. success — claims, runs recalc, marks done", async () => {
    claimResolve = { rowCount: 1 };

    await dispatchRecalcJob({
      id: "job-x",
      userId: "u1",
      kind: "progressive_overload",
      payload: { exerciseIds: ["e1"] },
    });

    expect(mockRecalcPO).toHaveBeenCalledWith("u1", ["e1"]);
    expect(updateSets[0]).toMatchObject({ status: "processing" });
    expect(updateSets[1]).toMatchObject({ status: "done" });
    expect(updateSets[1].processedAt).toBeInstanceOf(Date);
  });

  it("4. failure — recalc throws → marks failed, resolves without rejection", async () => {
    claimResolve = { rowCount: 1 };
    mockRecalcMGV.mockRejectedValue(new Error("boom"));

    await expect(
      dispatchRecalcJob({
        id: "job-y",
        userId: "u1",
        kind: "muscle_group_volume",
        payload: { weekOf: "2025-01-06T00:00:00.000Z" },
      }),
    ).resolves.toBeUndefined();

    const failed = updateSets.find((s) => s.status === "failed");
    expect(failed).toMatchObject({
      status: "failed",
      errorMessage: "boom",
    });
    expect(failed.processedAt).toBeInstanceOf(Date);
  });

  it("5. claim race — claim loses (rowCount 0) → no recalc, no done/failed write", async () => {
    claimResolve = { rowCount: 0 };

    await dispatchRecalcJob({
      id: "job-z",
      userId: "u1",
      kind: "progressive_overload",
      payload: { exerciseIds: ["e1"] },
    });

    expect(mockRecalcPO).not.toHaveBeenCalled();
    // only the claim attempt — no terminal status write
    expect(updateSets).toHaveLength(1);
    expect(updateSets[0]).toMatchObject({ status: "processing" });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// drainPendingRecalcJobs
// ────────────────────────────────────────────────────────────────────────────

describe("drainPendingRecalcJobs", () => {
  it("6. dispatches CTE-claimed rows and marks them done", async () => {
    mockDb.execute.mockResolvedValue({
      rows: [
        {
          id: "j1",
          user_id: "u1",
          kind: "muscle_group_volume",
          payload: { weekOf: "2025-01-06T00:00:00.000Z" },
        },
        {
          id: "j2",
          user_id: "u2",
          kind: "progressive_overload",
          payload: { exerciseIds: ["ex-9"] },
        },
      ],
    });

    const result = await drainPendingRecalcJobs();

    expect(result).toEqual({ scanned: 2, dispatched: 2 });

    await flushInFlight();

    expect(mockRecalcMGV).toHaveBeenCalledWith(
      "u1",
      new Date("2025-01-06T00:00:00.000Z"),
    );
    expect(mockRecalcPO).toHaveBeenCalledWith("u2", ["ex-9"]);
    // rows already claimed by the CTE → drain only writes terminal status
    expect(updateSets.filter((s) => s.status === "done")).toHaveLength(2);
    expect(updateSets.some((s) => s.status === "processing")).toBe(false);
  });
});
