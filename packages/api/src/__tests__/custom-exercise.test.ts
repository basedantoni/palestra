/**
 * Unit tests for the custom exercise library and notification features.
 *
 * The database is fully mocked — no real DB connection or secrets required.
 * Tests call through the actual tRPC procedures to verify behavior, not
 * implementation details like SQL column values.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.hoisted runs before any module imports, making these
// values available inside vi.mock factories AND in test bodies.
// ---------------------------------------------------------------------------
const { mockDb, mockTx, makeChain } = vi.hoisted(() => {
  /**
   * Creates a Drizzle-style chainable query builder.
   * Any method call (from, where, set, returning, etc.) returns the same
   * proxy, and the proxy itself is thenable — it resolves with `resolveWith`.
   */
  function makeChain(resolveWith: unknown = []) {
    const proxy: any = new Proxy(
      {},
      {
        get(_, prop: string) {
          if (prop === "then")
            return (ok: any) => Promise.resolve(resolveWith).then(ok);
          if (prop === "catch")
            return (err: any) => Promise.resolve(resolveWith).catch(err);
          if (prop === "finally")
            return (fin: any) => Promise.resolve(resolveWith).finally(fin);
          return vi.fn(() => proxy);
        },
      },
    );
    return proxy;
  }

  // Separate tx mock so approve/reject tests can assert on tx.insert calls
  const mockTx = {
    update: vi.fn(),
    insert: vi.fn(),
    select: vi.fn(),
  };

  const mockDb = {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  };

  return { mockDb, mockTx, makeChain };
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

// ---------------------------------------------------------------------------
// Router import — after mocks are registered
// ---------------------------------------------------------------------------
import { appRouter } from "../routers/index";

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------
const USER_ID = "00000000-0000-4000-8000-000000000001";
const ADMIN_ID = "00000000-0000-4000-8000-000000000002";
const EXERCISE_ID = "00000000-0000-4000-8000-000000000003";
const NOTIF_ID = "00000000-0000-4000-8000-000000000004";

const userCaller = appRouter.createCaller({
  session: {
    user: { id: USER_ID, email: "user@test.internal", name: "Test User" },
    session: { id: "sess-user", userId: USER_ID, expiresAt: new Date(Date.now() + 86400000) },
  },
  headers: new Headers(),
} as any);

const adminCaller = appRouter.createCaller({
  session: {
    user: { id: ADMIN_ID, email: "admin@test.internal", name: "Admin" },
    session: { id: "sess-admin", userId: ADMIN_ID, expiresAt: new Date(Date.now() + 86400000) },
  },
  headers: new Headers(),
} as any);

const unauthCaller = appRouter.createCaller({
  session: null,
  headers: new Headers(),
} as any);

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.transaction.mockImplementation(async (fn: any) => fn(mockTx));
});

// ---------------------------------------------------------------------------
// exercises.createCustom
// ---------------------------------------------------------------------------
describe("exercises.createCustom", () => {
  it("returns the created exercise with status pending", async () => {
    const created = {
      id: EXERCISE_ID,
      name: "Zercher Squat",
      category: "legs",
      exerciseType: "weightlifting",
      isCustom: true,
      status: "pending",
      linkedExerciseId: "00000000-0000-4000-8000-000000000010",
      createdByUserId: USER_ID,
      createdAt: new Date(),
    };
    mockDb.insert.mockReturnValue(makeChain([created]));

    const result = await userCaller.exercises.createCustom({
      name: "Zercher Squat",
      category: "legs",
      exerciseType: "weightlifting",
      linkedExerciseId: "00000000-0000-4000-8000-000000000010",
    });

    expect(result.status).toBe("pending");
    expect(result.isCustom).toBe(true);
    expect(result.linkedExerciseId).toBe("00000000-0000-4000-8000-000000000010");
  });

  it("throws UNAUTHORIZED for unauthenticated callers", async () => {
    await expect(
      unauthCaller.exercises.createCustom({
        name: "Test",
        category: "legs",
        exerciseType: "weightlifting",
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

// ---------------------------------------------------------------------------
// exercises.myCustomExercises
// ---------------------------------------------------------------------------
describe("exercises.myCustomExercises", () => {
  it("returns the authenticated user's custom exercises", async () => {
    const exercises = [
      { id: EXERCISE_ID, name: "My Custom Squat", isCustom: true, status: "pending", createdByUserId: USER_ID },
    ];
    mockDb.select.mockReturnValue(makeChain(exercises));

    const result = await userCaller.exercises.myCustomExercises();

    expect(result).toEqual(exercises);
  });
});

// ---------------------------------------------------------------------------
// admin.isAdmin
// ---------------------------------------------------------------------------
describe("admin.isAdmin", () => {
  it("returns true for users in the ADMIN_EMAILS allowlist", async () => {
    expect(await adminCaller.admin.isAdmin()).toBe(true);
  });

  it("throws FORBIDDEN for non-admin users", async () => {
    await expect(userCaller.admin.isAdmin()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ---------------------------------------------------------------------------
// admin.approveExercise
// ---------------------------------------------------------------------------
describe("admin.approveExercise", () => {
  it("returns the exercise promoted to the public library", async () => {
    const approved = {
      id: EXERCISE_ID,
      name: "Zercher Squat",
      isCustom: false,
      status: "approved",
      createdByUserId: USER_ID,
      approvedAt: new Date(),
      approvedByUserId: ADMIN_ID,
    };
    mockTx.update.mockReturnValue(makeChain([approved]));
    mockTx.insert.mockReturnValue(makeChain([]));

    const result = await adminCaller.admin.approveExercise({ id: EXERCISE_ID });

    expect(result.isCustom).toBe(false);
    expect(result.status).toBe("approved");
  });

  it("creates a notification for the original submitter", async () => {
    const approved = {
      id: EXERCISE_ID,
      name: "Zercher Squat",
      isCustom: false,
      status: "approved",
      createdByUserId: USER_ID, // has a submitter
    };
    mockTx.update.mockReturnValue(makeChain([approved]));
    mockTx.insert.mockReturnValue(makeChain([]));

    await adminCaller.admin.approveExercise({ id: EXERCISE_ID });

    expect(mockTx.insert).toHaveBeenCalledTimes(1);
  });

  it("does not create a notification when exercise has no submitter", async () => {
    const approved = {
      id: EXERCISE_ID,
      name: "Orphan Exercise",
      isCustom: false,
      status: "approved",
      createdByUserId: null, // admin-seeded exercise, no user to notify
    };
    mockTx.update.mockReturnValue(makeChain([approved]));

    await adminCaller.admin.approveExercise({ id: EXERCISE_ID });

    expect(mockTx.insert).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when the exercise does not exist or is not pending", async () => {
    mockTx.update.mockReturnValue(makeChain([])); // 0 rows updated

    await expect(
      adminCaller.admin.approveExercise({ id: EXERCISE_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("throws FORBIDDEN for non-admin callers", async () => {
    await expect(
      userCaller.admin.approveExercise({ id: EXERCISE_ID }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

// ---------------------------------------------------------------------------
// admin.rejectExercise
// ---------------------------------------------------------------------------
describe("admin.rejectExercise", () => {
  it("returns the exercise with status rejected and stores the reason", async () => {
    const rejected = {
      id: EXERCISE_ID,
      name: "Bad Exercise",
      isCustom: true,
      status: "rejected",
      rejectedReason: "Duplicate of existing exercise",
    };
    mockDb.update.mockReturnValue(makeChain([rejected]));

    const result = await adminCaller.admin.rejectExercise({
      id: EXERCISE_ID,
      reason: "Duplicate of existing exercise",
    });

    expect(result.status).toBe("rejected");
    expect(result.rejectedReason).toBe("Duplicate of existing exercise");
  });

  it("does not create a notification on rejection", async () => {
    const rejected = { id: EXERCISE_ID, isCustom: true, status: "rejected" };
    mockDb.update.mockReturnValue(makeChain([rejected]));

    await adminCaller.admin.rejectExercise({ id: EXERCISE_ID });

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND when the exercise does not exist or is not pending", async () => {
    mockDb.update.mockReturnValue(makeChain([]));

    await expect(
      adminCaller.admin.rejectExercise({ id: EXERCISE_ID }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

// ---------------------------------------------------------------------------
// notifications.list
// ---------------------------------------------------------------------------
describe("notifications.list", () => {
  it("returns the authenticated user's notifications", async () => {
    const notifs = [
      { id: NOTIF_ID, title: "Exercise Approved!", userId: USER_ID, readAt: null, createdAt: new Date() },
    ];
    mockDb.select.mockReturnValue(makeChain(notifs));

    const result = await userCaller.notifications.list();

    expect(result).toEqual(notifs);
  });
});

// ---------------------------------------------------------------------------
// notifications.unreadCount
// ---------------------------------------------------------------------------
describe("notifications.unreadCount", () => {
  it("returns the number of unread notifications", async () => {
    mockDb.select.mockReturnValue(makeChain([{ count: 3 }]));

    expect(await userCaller.notifications.unreadCount()).toBe(3);
  });

  it("returns 0 when there are no unread notifications", async () => {
    mockDb.select.mockReturnValue(makeChain([])); // empty result → fallback to 0

    expect(await userCaller.notifications.unreadCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// notifications.markRead
// ---------------------------------------------------------------------------
describe("notifications.markRead", () => {
  it("returns the notification with readAt populated", async () => {
    const updated = { id: NOTIF_ID, userId: USER_ID, readAt: new Date() };
    mockDb.update.mockReturnValue(makeChain([updated]));

    const result = await userCaller.notifications.markRead({ id: NOTIF_ID });

    expect(result?.readAt).toBeDefined();
  });

  it("returns null when notification is not found", async () => {
    mockDb.update.mockReturnValue(makeChain([]));

    const result = await userCaller.notifications.markRead({ id: NOTIF_ID });

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// notifications.markAllRead
// ---------------------------------------------------------------------------
describe("notifications.markAllRead", () => {
  it("returns success", async () => {
    mockDb.update.mockReturnValue(makeChain([]));

    const result = await userCaller.notifications.markAllRead();

    expect(result).toEqual({ success: true });
  });

  it("only touches the DB once (single update, not per-notification)", async () => {
    mockDb.update.mockReturnValue(makeChain([]));

    await userCaller.notifications.markAllRead();

    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });
});
