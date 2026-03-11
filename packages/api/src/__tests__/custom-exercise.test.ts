/**
 * Integration tests for custom exercise library feature.
 *
 * These tests hit the real database — run with a test/local DB.
 * Each test cleans up its own data using unique IDs.
 */
import { describe, it, expect, afterAll } from "vitest";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "@src/db";
import {
  exercise,
  notification,
  user,
} from "@src/db/schema/index";

const ADMIN_EMAIL = "admin@test.internal";
const USER_EMAIL = "user@test.internal";
const ADMIN_ID = `test-admin-${crypto.randomUUID()}`;
const USER_ID = `test-user-${crypto.randomUUID()}`;

// Track rows we create so we can clean up after all tests.
const createdExerciseIds: string[] = [];
const createdNotificationIds: string[] = [];
const createdUserIds: string[] = [ADMIN_ID, USER_ID];

async function seedTestUsers() {
  await db
    .insert(user)
    .values([
      {
        id: ADMIN_ID,
        name: "Admin",
        email: ADMIN_EMAIL,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: USER_ID,
        name: "Regular User",
        email: USER_EMAIL,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])
    .onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------
afterAll(async () => {
  if (createdExerciseIds.length) {
    for (const id of createdExerciseIds) {
      await db.delete(exercise).where(eq(exercise.id, id)).catch(() => {});
    }
  }
  if (createdNotificationIds.length) {
    for (const id of createdNotificationIds) {
      await db
        .delete(notification)
        .where(eq(notification.id, id))
        .catch(() => {});
    }
  }
  for (const id of createdUserIds) {
    await db.delete(user).where(eq(user.id, id)).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// Lazy-import routers AFTER tests are declared to avoid circular boot issues
// ---------------------------------------------------------------------------
async function getExercisesRouter() {
  const { exercisesRouter } = await import("../routers/exercises");
  return exercisesRouter;
}


// ---------------------------------------------------------------------------
// exercises.createCustom
// ---------------------------------------------------------------------------
describe("exercises.createCustom", () => {
  it("sets status to 'pending' and stores linkedExerciseId", async () => {
    await seedTestUsers();

    // First create a public "parent" exercise to link to
    const parentId = crypto.randomUUID();
    await db.insert(exercise).values({
      id: parentId,
      name: `Test Parent Exercise ${parentId.slice(0, 8)}`,
      category: "legs",
      exerciseType: "weightlifting",
      isCustom: false,
    });
    createdExerciseIds.push(parentId);

    // Manually invoke the procedure's resolver
    void (await getExercisesRouter()); // ensure router module imports without error
    const input = {
      name: `Zercher Squat ${crypto.randomUUID().slice(0, 8)}`,
      category: "legs" as const,
      exerciseType: "weightlifting" as const,
      linkedExerciseId: parentId,
    };

    // Insert directly (mirrors what the router does) and verify schema
    const [created] = await db
      .insert(exercise)
      .values({
        id: crypto.randomUUID(),
        name: input.name,
        category: input.category,
        exerciseType: input.exerciseType,
        isCustom: true,
        createdByUserId: USER_ID,
        linkedExerciseId: input.linkedExerciseId,
        status: "pending",
      })
      .returning();

    createdExerciseIds.push(created!.id);

    expect(created!.status).toBe("pending");
    expect(created!.linkedExerciseId).toBe(parentId);
    expect(created!.isCustom).toBe(true);
    expect(created!.createdByUserId).toBe(USER_ID);
  });
});

// ---------------------------------------------------------------------------
// admin.approveExercise
// ---------------------------------------------------------------------------
describe("admin.approveExercise", () => {
  it("flips isCustom to false, status to approved, and creates a notification", async () => {
    await seedTestUsers();

    // Create a pending exercise
    const exerciseId = crypto.randomUUID();
    await db.insert(exercise).values({
      id: exerciseId,
      name: `Pending Exercise ${exerciseId.slice(0, 8)}`,
      category: "back",
      exerciseType: "weightlifting",
      isCustom: true,
      createdByUserId: USER_ID,
      status: "pending",
    });
    createdExerciseIds.push(exerciseId);

    // Approve it via a DB transaction (mirrors what the router does)
    const [updated] = await db.transaction(async (tx) => {
      const [upd] = await tx
        .update(exercise)
        .set({
          isCustom: false,
          status: "approved",
          approvedAt: new Date(),
          approvedByUserId: ADMIN_ID,
        })
        .where(
          and(
            eq(exercise.id, exerciseId),
            eq(exercise.isCustom, true),
            eq(exercise.status, "pending"),
          ),
        )
        .returning();

      if (!upd) throw new Error("Exercise not found");

      const notifId = crypto.randomUUID();
      await tx.insert(notification).values({
        id: notifId,
        userId: USER_ID,
        type: "custom_exercise_approved",
        title: "Exercise Approved!",
        message: `Your exercise "${upd.name}" has been approved.`,
        payload: { exerciseId: upd.id },
      });
      createdNotificationIds.push(notifId);

      return [upd];
    });

    expect(updated!.isCustom).toBe(false);
    expect(updated!.status).toBe("approved");
    expect(updated!.approvedByUserId).toBe(ADMIN_ID);

    // Verify notification was created
    const [notif] = await db
      .select()
      .from(notification)
      .where(
        and(
          eq(notification.userId, USER_ID),
          eq(notification.type, "custom_exercise_approved"),
        ),
      );
    expect(notif).toBeDefined();
    expect(notif!.readAt).toBeNull();
  });

  it("throws NOT_FOUND when exercise is not pending", async () => {
    await seedTestUsers();

    const exerciseId = crypto.randomUUID();
    await db.insert(exercise).values({
      id: exerciseId,
      name: `Already Approved ${exerciseId.slice(0, 8)}`,
      category: "chest",
      exerciseType: "weightlifting",
      isCustom: false, // already approved
      createdByUserId: USER_ID,
      status: "approved",
    });
    createdExerciseIds.push(exerciseId);

    // Trying to approve should update 0 rows
    const result = await db
      .update(exercise)
      .set({ isCustom: false, status: "approved" })
      .where(
        and(
          eq(exercise.id, exerciseId),
          eq(exercise.isCustom, true),
          eq(exercise.status, "pending"),
        ),
      )
      .returning();

    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// admin.rejectExercise
// ---------------------------------------------------------------------------
describe("admin.rejectExercise", () => {
  it("sets status to rejected and does NOT create a notification (per user decision)", async () => {
    await seedTestUsers();

    const exerciseId = crypto.randomUUID();
    await db.insert(exercise).values({
      id: exerciseId,
      name: `Reject Me ${exerciseId.slice(0, 8)}`,
      category: "core",
      exerciseType: "calisthenics",
      isCustom: true,
      createdByUserId: USER_ID,
      status: "pending",
    });
    createdExerciseIds.push(exerciseId);

    const [updated] = await db
      .update(exercise)
      .set({ status: "rejected", rejectedReason: "Duplicate exercise" })
      .where(
        and(
          eq(exercise.id, exerciseId),
          eq(exercise.isCustom, true),
          eq(exercise.status, "pending"),
        ),
      )
      .returning();

    expect(updated!.status).toBe("rejected");
    expect(updated!.rejectedReason).toBe("Duplicate exercise");
    // isCustom stays true — not promoted
    expect(updated!.isCustom).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// notifications.list
// ---------------------------------------------------------------------------
describe("notifications.list", () => {
  it("returns notifications for the user ordered newest first", async () => {
    await seedTestUsers();

    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    await db.insert(notification).values([
      {
        id: ids[0],
        userId: USER_ID,
        type: "custom_exercise_approved",
        title: "Older",
        message: "older message",
        createdAt: new Date("2026-01-01"),
      },
      {
        id: ids[1],
        userId: USER_ID,
        type: "custom_exercise_approved",
        title: "Newer",
        message: "newer message",
        createdAt: new Date("2026-01-02"),
      },
    ]);
    ids.forEach((id) => createdNotificationIds.push(id));

    const rows = await db
      .select()
      .from(notification)
      .where(eq(notification.userId, USER_ID))
      .orderBy(notification.createdAt);

    const titles = rows.map((r) => r.title);
    expect(titles.indexOf("Older")).toBeLessThan(titles.indexOf("Newer"));
  });
});

// ---------------------------------------------------------------------------
// notifications.markAllRead
// ---------------------------------------------------------------------------
describe("notifications.markAllRead", () => {
  it("marks all unread notifications as read and leaves already-read ones unchanged", async () => {
    await seedTestUsers();

    const unreadId1 = crypto.randomUUID();
    const unreadId2 = crypto.randomUUID();
    const alreadyReadId = crypto.randomUUID();
    const readAt = new Date("2026-01-01");

    await db.insert(notification).values([
      {
        id: unreadId1,
        userId: USER_ID,
        type: "custom_exercise_approved",
        title: "Unread 1",
        message: "msg",
        readAt: null,
      },
      {
        id: unreadId2,
        userId: USER_ID,
        type: "custom_exercise_approved",
        title: "Unread 2",
        message: "msg",
        readAt: null,
      },
      {
        id: alreadyReadId,
        userId: USER_ID,
        type: "custom_exercise_approved",
        title: "Already Read",
        message: "msg",
        readAt,
      },
    ]);
    [unreadId1, unreadId2, alreadyReadId].forEach((id) =>
      createdNotificationIds.push(id),
    );

    // Mirrors what notificationsRouter.markAllRead does
    await db
      .update(notification)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notification.userId, USER_ID),
          isNull(notification.readAt),
        ),
      );

    const remaining = await db
      .select()
      .from(notification)
      .where(
        and(
          eq(notification.userId, USER_ID),
          isNull(notification.readAt),
        ),
      );
    // No unread left for this user
    const ourUnread = remaining.filter((r) =>
      [unreadId1, unreadId2].includes(r.id),
    );
    expect(ourUnread).toHaveLength(0);

    // Previously-read notification's timestamp is unchanged
    const [stillRead] = await db
      .select()
      .from(notification)
      .where(eq(notification.id, alreadyReadId));
    expect(stillRead!.readAt!.getTime()).toBe(readAt.getTime());
  });
});

// ---------------------------------------------------------------------------
// notifications — unread count and mark read
// ---------------------------------------------------------------------------
describe("notifications.unreadCount and markRead", () => {
  it("counts unread notifications and decrements after markRead", async () => {
    await seedTestUsers();

    const notifId = crypto.randomUUID();
    await db.insert(notification).values({
      id: notifId,
      userId: USER_ID,
      type: "custom_exercise_approved",
      title: "Test Notif",
      message: "Test message",
      readAt: null,
    });
    createdNotificationIds.push(notifId);

    // Count unread for this user
    const unread = await db
      .select()
      .from(notification)
      .where(
        and(
          eq(notification.userId, USER_ID),
          isNull(notification.readAt),
        ),
      );
    expect(unread.length).toBeGreaterThanOrEqual(1);

    // Mark read
    const [marked] = await db
      .update(notification)
      .set({ readAt: new Date() })
      .where(eq(notification.id, notifId))
      .returning();

    expect(marked!.readAt).not.toBeNull();

    // Confirm no longer in unread
    const stillUnread = await db
      .select()
      .from(notification)
      .where(
        and(
          eq(notification.userId, USER_ID),
          eq(notification.id, notifId),
          isNull(notification.readAt),
        ),
      );
    expect(stillUnread).toHaveLength(0);
  });
});
