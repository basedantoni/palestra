import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@life-tracker/db", () => import("./helpers/mock-db").then((m) => m.mockDbModule));

vi.mock("@life-tracker/env/server", () => ({
  env: {
    ADMIN_EMAILS: "admin@test.internal",
    NODE_ENV: "test",
    DATABASE_URL: "postgresql://test:test@localhost:5432/testdb",
    BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters-long!!",
    BETTER_AUTH_URL: "http://localhost:3000",
    CORS_ORIGIN: "http://localhost:3001",
  },
}));

vi.mock("../lib/recalc-queue", () => ({
  enqueueRecalcs: vi.fn().mockResolvedValue(undefined),
}));

import { workout } from "@life-tracker/db/schema/index";

import { appRouter } from "../routers/index";
import { mockDb } from "./helpers/mock-db";

const USER_ID = "00000000-0000-4000-8000-000000000298";

const userCaller = appRouter.createCaller({
  session: {
    user: { id: USER_ID, email: "athlete@test.internal", name: "Athlete" },
    session: {
      id: "sess-athlete",
      userId: USER_ID,
      expiresAt: new Date(Date.now() + 86400000),
    },
  },
  headers: new Headers(),
} as any);

describe("analytics.volumeOverTime", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("aggregates weekly volume when scoped by string date bounds", async () => {
    mockDb.onSelect(workout, [
      { date: new Date("2026-04-07T12:00:00.000Z"), totalVolume: 1000 },
      { date: new Date("2026-04-09T12:00:00.000Z"), totalVolume: 700 },
      { date: new Date("2026-04-15T12:00:00.000Z"), totalVolume: 600 },
    ]);

    const result = await userCaller.analytics.volumeOverTime({
      granularity: "weekly",
      from: "2026-04-01",
      to: "2026-04-30",
    });

    expect(result).toEqual([
      {
        period: "2026-W15",
        totalVolume: 1700,
        workoutCount: 2,
      },
      {
        period: "2026-W16",
        totalVolume: 600,
        workoutCount: 1,
      },
    ]);
  });

  it("aggregates monthly volume without requiring date bounds", async () => {
    mockDb.onSelect(workout, [
      { date: new Date("2026-04-07T12:00:00.000Z"), totalVolume: 1000 },
      { date: new Date("2026-05-09T12:00:00.000Z"), totalVolume: 700 },
    ]);

    const result = await userCaller.analytics.volumeOverTime({
      granularity: "monthly",
    });

    expect(result).toEqual([
      {
        period: "2026-04",
        totalVolume: 1000,
        workoutCount: 1,
      },
      {
        period: "2026-05",
        totalVolume: 700,
        workoutCount: 1,
      },
    ]);
  });
});
