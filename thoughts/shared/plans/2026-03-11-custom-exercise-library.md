# Custom Exercise Library — Implementation Plan

## Overview

Allow users to create custom exercises (not in the public library), optionally link them to an existing "parent" exercise as a movement-pattern reference, and let admins approve custom exercises into the public library with automatic user notification.

## Current State Analysis

### Exercise table (`packages/db/src/schema/exercise.ts`)
The `exercise` table already has:
- `isCustom` boolean (default `false`)
- `createdByUserId` FK to `user.id` (nullable — null for public exercises)

Custom exercises are created via `exercises.createCustom` in `packages/api/src/routers/exercises.ts`. They are inserted directly into the `exercise` table with `isCustom: true`.

### Admin system (`packages/api/src/index.ts`)
Admin access is controlled by an **email allowlist** (`ADMIN_EMAILS` env var). There is an `adminProcedure` middleware that gates on this list. No DB-level role column exists — and none is needed; the env-var approach is sufficient for this feature.

### Key files
| Area | File |
|------|------|
| Exercise schema | `packages/db/src/schema/exercise.ts` |
| Enums | `packages/db/src/schema/enums.ts` |
| Exercise router | `packages/api/src/routers/exercises.ts` |
| Admin router | `packages/api/src/routers/admin.ts` |
| tRPC root | `packages/api/src/routers/index.ts` |
| tRPC setup / adminProcedure | `packages/api/src/index.ts` |
| Web exercise picker | `apps/web/src/components/workout/exercise-picker.tsx` |
| Native exercise picker | `apps/native/components/workout/exercise-picker.tsx` |
| Web header | `apps/web/src/components/header.tsx` |
| Web root layout | `apps/web/src/routes/__root.tsx` |
| Drizzle config | `packages/db/drizzle.config.ts` (migrations in `packages/db/src/migrations/`) |
| DB scripts | `packages/db/package.json` — `db:generate`, `db:push`, `db:migrate` |

### What already works
- Users can create/update/delete custom exercises (stored inline in `exercise` table with `isCustom: true`)
- Exercise search returns public exercises + the current user's custom exercises
- Admin can CRUD public exercises and system templates

### What is missing
1. No approval workflow — custom exercises are private forever or manually added by admin
2. No `linkedExerciseId` (parent exercise reference)
3. No notification system
4. No "pending/approved/rejected" status on custom exercises
5. No admin UI for reviewing user-submitted custom exercises

## Desired End State

1. Users create custom exercises with an optional **linked parent exercise** (e.g., "Zercher Squat" linked to "Front Squat")
2. Custom exercises have a **status** (`pending`, `approved`, `rejected`) visible to the creating user
3. Admins see a queue of pending custom exercises and can approve or reject them
4. On approval, the custom exercise is **promoted** — a new public `exercise` row is created (or the existing row is updated to `isCustom: false`) and the user is **notified**
5. Notifications are surfaced via a bell icon in the web header and a badge on native

### Verification
- A user creates "Zercher Squat" linked to "Front Squat" — it appears in **their** exercise list with a "Pending" badge
- An admin opens `/admin/exercises/pending`, sees the submission, and approves it
- The exercise now appears in **all** users' exercise lists (public)
- The original user sees a notification: "Your exercise 'Zercher Squat' has been approved and added to the public library"

## What We're NOT Doing

- Push notifications (mobile/web push) — in-app only via DB polling
- Real-time WebSocket/subscription-based notifications — simple polling with `refetchInterval`
- User-to-user sharing of custom exercises
- Editing a custom exercise after it has been approved
- Reject reason displayed to the user (we store it for admin reference, but v1 just shows "rejected" status)
- Admin UI for notifications management
- Native admin panel (admin actions are web-only)

## Implementation Approach

We use the **existing `exercise` table** rather than a separate `custom_exercise` table. The current schema already supports `isCustom` + `createdByUserId`. We add a `status` column and `linkedExerciseId` self-referential FK to the same table. This avoids data duplication and means approved exercises just flip `isCustom` from `true` to `false`.

For notifications, we create a lightweight `notification` table with a `type` enum and JSON `payload`. The web/native clients poll for unread count.

---

## Phase 1: Database Schema Changes

### Overview
Add columns to `exercise`, create the `notification` table, generate and run the Drizzle migration.

### Changes Required

#### 1. New enum: `customExerciseStatusEnum`
**File**: `packages/db/src/schema/enums.ts`

Add after the existing enums:

```ts
export const customExerciseStatusEnum = pgEnum("custom_exercise_status", [
  "pending",
  "approved",
  "rejected",
]);

export const notificationTypeEnum = pgEnum("notification_type", [
  "custom_exercise_approved",
  "custom_exercise_rejected",
]);
```

#### 2. Extend `exercise` table
**File**: `packages/db/src/schema/exercise.ts`

Add three columns to the `exercise` table:

```ts
// New imports needed: customExerciseStatusEnum from "./enums"
linkedExerciseId: uuid("linked_exercise_id").references((): any => exercise.id, { onDelete: "set null" }),
status: customExerciseStatusEnum("status"),  // null for public library exercises, set for custom
rejectedReason: text("rejected_reason"),
approvedAt: timestamp("approved_at"),
approvedByUserId: text("approved_by_user_id").references(() => user.id),
```

Add a new relation inside `exerciseRelations`:

```ts
linkedExercise: one(exercise, {
  fields: [exercise.linkedExerciseId],
  references: [exercise.id],
  relationName: "linkedExercise",
}),
linkedChildren: many(exercise, { relationName: "linkedExercise" }),
```

Add a new index:

```ts
index("exercise_status_idx").on(table.status),
```

#### 3. New `notification` table
**File**: `packages/db/src/schema/notification.ts` (new file)

```ts
import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { notificationTypeEnum } from "./enums";
import { user } from "./auth";

export const notification = pgTable(
  "notification",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: notificationTypeEnum("type").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("notification_userId_idx").on(table.userId),
    index("notification_userId_readAt_idx").on(table.userId, table.readAt),
  ],
);

export const notificationRelations = relations(notification, ({ one }) => ({
  user: one(user, {
    fields: [notification.userId],
    references: [user.id],
  }),
}));
```

#### 4. Update schema barrel export
**File**: `packages/db/src/schema/index.ts`

Add:

```ts
export * from "./notification";
```

#### 5. Update user relations
**File**: `packages/db/src/schema/auth.ts`

Add `notification` import and add to `userRelations`:

```ts
notifications: many(notification),
```

#### 6. Generate migration

```bash
cd packages/db && pnpm db:generate
```

### Success Criteria

#### Automated Verification:
- [ ] Migration generates without errors: `cd packages/db && pnpm db:generate`
- [ ] Migration applies cleanly: `cd packages/db && pnpm db:push`
- [ ] TypeScript compiles: `pnpm -C packages/db tsc --noEmit`

#### Manual Verification:
- [ ] Inspect the generated SQL migration file in `packages/db/src/migrations/` to confirm it matches expectations
- [ ] Verify in Drizzle Studio (`pnpm -C packages/db db:studio`) that the new columns and table exist

**Pause here for manual confirmation before proceeding to Phase 2.**

---

## Phase 2: tRPC API — Custom Exercise Submission & Notifications

### Overview
Extend the exercises router with submission/status features, add admin approval/rejection endpoints, and create a notification router.

### Changes Required

#### 1. Update `exercises.createCustom` to include `linkedExerciseId` and set `status`
**File**: `packages/api/src/routers/exercises.ts`

Update the `exerciseInput` schema:

```ts
const exerciseInput = z.object({
  name: z.string().min(1),
  category: z.enum([
    "chest", "back", "shoulders", "arms", "legs", "core", "cardio", "other",
  ]),
  exerciseType: z.enum([
    "weightlifting", "hiit", "cardio", "calisthenics", "yoga", "sports", "mixed",
  ]),
  muscleGroupsBodybuilding: z
    .array(z.enum(["chest", "back", "shoulders", "arms", "legs", "core"]))
    .optional(),
  muscleGroupsMovement: z
    .array(z.enum(["push", "pull", "squat", "hinge", "carry"]))
    .optional(),
  linkedExerciseId: z.string().uuid().optional(), // NEW
});
```

Update the `createCustom` mutation to set `status: "pending"` and pass `linkedExerciseId`:

```ts
createCustom: protectedProcedure
  .input(exerciseInput)
  .mutation(async ({ ctx, input }) => {
    const [created] = await db
      .insert(exercise)
      .values({
        id: crypto.randomUUID(),
        name: input.name,
        category: input.category,
        muscleGroupsBodybuilding: input.muscleGroupsBodybuilding,
        muscleGroupsMovement: input.muscleGroupsMovement,
        exerciseType: input.exerciseType,
        isCustom: true,
        createdByUserId: ctx.session.user.id,
        linkedExerciseId: input.linkedExerciseId ?? null,
        status: "pending",
      })
      .returning();
    return created!;
  }),
```

Add a `myCustomExercises` query (user's submissions with status):

```ts
myCustomExercises: protectedProcedure.query(async ({ ctx }) => {
  return db
    .select()
    .from(exercise)
    .where(
      and(
        eq(exercise.isCustom, true),
        eq(exercise.createdByUserId, ctx.session.user.id),
      ),
    )
    .orderBy(exercise.createdAt);
}),
```

#### 2. Add admin approval/rejection endpoints
**File**: `packages/api/src/routers/admin.ts`

Add these new procedures to the `adminRouter`:

```ts
// List pending custom exercises (all users)
pendingExercises: adminProcedure.query(async () => {
  return db
    .select({
      exercise: exercise,
      submittedBy: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    })
    .from(exercise)
    .innerJoin(user, eq(exercise.createdByUserId, user.id))
    .where(
      and(
        eq(exercise.isCustom, true),
        eq(exercise.status, "pending"),
      ),
    )
    .orderBy(exercise.createdAt);
}),

// Approve a custom exercise → promote to public library + notify user
approveExercise: adminProcedure
  .input(z.object({ id: z.string().uuid() }))
  .mutation(async ({ ctx, input }) => {
    return db.transaction(async (tx) => {
      // Update the exercise: mark as approved and public
      const [updated] = await tx
        .update(exercise)
        .set({
          isCustom: false,
          status: "approved",
          approvedAt: new Date(),
          approvedByUserId: ctx.session.user.id,
        })
        .where(
          and(
            eq(exercise.id, input.id),
            eq(exercise.isCustom, true),
            eq(exercise.status, "pending"),
          ),
        )
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pending exercise not found",
        });
      }

      // Create notification for the submitting user
      if (updated.createdByUserId) {
        await tx.insert(notification).values({
          id: crypto.randomUUID(),
          userId: updated.createdByUserId,
          type: "custom_exercise_approved",
          title: "Exercise Approved!",
          message: `Your exercise "${updated.name}" has been approved and added to the public library.`,
          payload: { exerciseId: updated.id, exerciseName: updated.name },
        });
      }

      return updated;
    });
  }),

// Reject a custom exercise + notify user
rejectExercise: adminProcedure
  .input(
    z.object({
      id: z.string().uuid(),
      reason: z.string().optional(),
    }),
  )
  .mutation(async ({ ctx, input }) => {
    return db.transaction(async (tx) => {
      const [updated] = await tx
        .update(exercise)
        .set({
          status: "rejected",
          rejectedReason: input.reason ?? null,
        })
        .where(
          and(
            eq(exercise.id, input.id),
            eq(exercise.isCustom, true),
            eq(exercise.status, "pending"),
          ),
        )
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Pending exercise not found",
        });
      }

      if (updated.createdByUserId) {
        await tx.insert(notification).values({
          id: crypto.randomUUID(),
          userId: updated.createdByUserId,
          type: "custom_exercise_rejected",
          title: "Exercise Not Approved",
          message: `Your exercise "${updated.name}" was not approved for the public library.`,
          payload: {
            exerciseId: updated.id,
            exerciseName: updated.name,
            reason: input.reason ?? null,
          },
        });
      }

      return updated;
    });
  }),
```

Required imports to add at the top of `admin.ts`:

```ts
import { notification } from "@src/db/schema/index"; // add to existing import
import { user } from "@src/db/schema/index";          // add to existing import
import { TRPCError } from "@trpc/server";
```

#### 3. Create notification router
**File**: `packages/api/src/routers/notifications.ts` (new file)

```ts
import { z } from "zod";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "@src/db";
import { notification } from "@src/db/schema/index";

import { protectedProcedure, router } from "../index";

export const notificationsRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(50).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 20;
      return db
        .select()
        .from(notification)
        .where(eq(notification.userId, ctx.session.user.id))
        .orderBy(desc(notification.createdAt))
        .limit(limit);
    }),

  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notification)
      .where(
        and(
          eq(notification.userId, ctx.session.user.id),
          isNull(notification.readAt),
        ),
      );
    return result?.count ?? 0;
  }),

  markRead: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await db
        .update(notification)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notification.id, input.id),
            eq(notification.userId, ctx.session.user.id),
          ),
        )
        .returning();
      return updated ?? null;
    }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    await db
      .update(notification)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notification.userId, ctx.session.user.id),
          isNull(notification.readAt),
        ),
      );
    return { success: true };
  }),
});
```

#### 4. Register the notifications router
**File**: `packages/api/src/routers/index.ts`

```ts
import { notificationsRouter } from "./notifications";

// Add to appRouter:
notifications: notificationsRouter,
```

### Success Criteria

#### Automated Verification:
- [ ] TypeScript compiles: `pnpm -C packages/api tsc --noEmit`
- [ ] Full monorepo type check passes: `pnpm turbo typecheck` (or equivalent)

#### Manual Verification:
- [ ] Using tRPC panel or curl, create a custom exercise with `linkedExerciseId` — confirm it has `status: "pending"`
- [ ] Call `exercises.myCustomExercises` — confirm the new exercise appears with status
- [ ] Call `admin.pendingExercises` — confirm it appears with submitter info
- [ ] Call `admin.approveExercise` — confirm exercise flips to `isCustom: false`, `status: "approved"`
- [ ] Call `notifications.list` — confirm the approval notification exists for the submitting user
- [ ] Call `notifications.unreadCount` — returns 1
- [ ] Call `notifications.markRead` — `readAt` is set, unread count drops to 0

**Pause here for manual confirmation before proceeding to Phase 3.**

---

## Phase 3: Web UI — Exercise Submission, Status, Admin Panel, Notifications

### Overview
Add the "Can't find your exercise?" CTA in the exercise picker, a custom exercise creation modal, a "My Custom Exercises" section, the admin pending-exercises page, and a notification bell in the header.

### Changes Required

#### 1. Create Custom Exercise Modal
**File**: `apps/web/src/components/workout/create-custom-exercise-modal.tsx` (new file)

- Dialog with form fields: name, category (select), exerciseType (select), muscleGroups (multi-select), optional linked exercise (search-as-you-type using `exercises.search` query)
- On submit, calls `exercises.createCustom` mutation
- Shows success toast via `sonner`
- Props: `open`, `onOpenChange`, `onCreated?: (exercise) => void`

Key implementation details:
- Use `startTransition` for the linked-exercise search input (non-urgent update)
- Linked exercise search uses the existing `exercises.search` query with debounced input
- Form validation via zod schema (reuse/import the same enum values from `@src/shared` or inline)

#### 2. Update Exercise Picker — add "Can't find?" CTA
**File**: `apps/web/src/components/workout/exercise-picker.tsx`

After the "No exercises found" empty state (and also always visible at the bottom of the list), add:

```tsx
<button
  onClick={() => setShowCreateCustom(true)}
  className="w-full p-3 text-center text-sm text-primary hover:bg-muted transition-colors"
>
  Can't find your exercise? Create a custom one
</button>
```

Add state: `const [showCreateCustom, setShowCreateCustom] = useState(false);`

Render `<CreateCustomExerciseModal>` with `onCreated` that selects the new exercise and closes both modals.

#### 3. My Custom Exercises section
**File**: `apps/web/src/routes/settings.tsx` (extend existing)

Add a new section below existing settings content:

- "My Custom Exercises" heading
- Query: `exercises.myCustomExercises`
- Table/list showing: name, category, status badge (pending=yellow, approved=green, rejected=red), linked exercise name, created date
- Status badges use the existing `<Badge>` component with appropriate `variant`

#### 4. Admin Pending Exercises page
**File**: `apps/web/src/routes/admin/exercises/pending.tsx` (new file — TanStack Router file-based route)

Also create the layout route files:
- `apps/web/src/routes/admin.tsx` — layout with admin nav, guards on `adminEmails` (or simply let the tRPC call fail with FORBIDDEN)
- `apps/web/src/routes/admin/index.tsx` — redirect to `/admin/exercises/pending`
- `apps/web/src/routes/admin/exercises/pending.tsx` — the actual page

Page contents:
- Table of pending exercises with columns: Name, Category, Type, Muscle Groups, Linked Exercise, Submitted By, Date
- Each row has "Approve" (green) and "Reject" (red) buttons
- Reject opens a small dialog for optional reason text
- Uses `admin.pendingExercises` query and `admin.approveExercise` / `admin.rejectExercise` mutations
- On success, invalidate the pending list query and show toast

#### 5. Notification Bell in Header
**File**: `apps/web/src/components/notification-bell.tsx` (new file)

- Bell icon (from `lucide-react`: `Bell`)
- Unread count badge (red circle with number) — uses `notifications.unreadCount` query with `refetchInterval: 30_000` (poll every 30s)
- Click opens a `Popover` with notification list (`notifications.list` query)
- Each notification item shows title, message, time ago, read/unread styling
- "Mark all as read" button at top of popover
- Clicking a notification marks it as read via `notifications.markRead`

**File**: `apps/web/src/components/header.tsx`

Add the `<NotificationBell />` component next to `<ModeToggle />` and `<UserMenu />`:

```tsx
<div className="flex items-center gap-2">
  <NotificationBell />
  <ModeToggle />
  <UserMenu />
</div>
```

### Success Criteria

#### Automated Verification:
- [ ] TypeScript compiles: `pnpm -C apps/web tsc --noEmit`
- [ ] Build succeeds: `pnpm -C apps/web build`
- [ ] Lint passes: `pnpm -C apps/web lint`

#### Manual Verification:
- [ ] Open exercise picker in workout creation flow — "Can't find your exercise?" link is visible
- [ ] Click CTA — custom exercise modal opens with all fields
- [ ] Search for a linked exercise — results appear, can select one
- [ ] Submit — exercise created, toast shown, picker closes with new exercise selected
- [ ] Go to Settings — "My Custom Exercises" section shows the new exercise with "Pending" badge
- [ ] Navigate to `/admin/exercises/pending` (as admin user) — pending exercise appears in table
- [ ] Click Approve — exercise disappears from pending list, toast confirms
- [ ] Check notification bell — unread count badge appears (1)
- [ ] Click bell — notification popover shows "Exercise Approved!" message
- [ ] Click "Mark all as read" — badge disappears
- [ ] Go back to Settings — exercise now shows "Approved" badge
- [ ] As a non-admin user, search for the exercise — it now appears in the public list

**Pause here for manual confirmation before proceeding to Phase 4.**

---

## Phase 4: Native UI — Exercise Submission & Notifications

### Overview
Mirror the web experience in the React Native app: add custom exercise creation in the exercise picker and a notification indicator.

### Changes Required

#### 1. Create Custom Exercise Sheet
**File**: `apps/native/components/workout/create-custom-exercise-sheet.tsx` (new file)

- Modal (presentationStyle "pageSheet") with form fields matching web version
- Uses React Native `TextInput`, `Pressable`, `ScrollView`
- Linked exercise search: `TextInput` + `FlatList` dropdown using `exercises.search`
- Category and exercise type pickers: horizontal `ScrollView` with `Chip` components (matching existing exercise picker pattern)
- Muscle group multi-select: grid of toggleable chips
- Submit calls `exercises.createCustom`

#### 2. Update Native Exercise Picker
**File**: `apps/native/components/workout/exercise-picker.tsx`

Add a "Can't find your exercise?" `Pressable` at the bottom of the `FlatList` (via `ListFooterComponent`) and in the empty state:

```tsx
<Pressable onPress={() => setShowCreateCustom(true)}>
  <Text className="text-primary text-center py-4">
    Can't find your exercise? Create a custom one
  </Text>
</Pressable>
```

Render `<CreateCustomExerciseSheet>` modal.

**Important**: Do NOT nest the create-exercise modal inside the existing exercise picker `Modal`. Use a separate state variable and render it as a sibling.

#### 3. Notification Badge on Profile/Settings Tab
**File**: `apps/native/` (wherever the tab navigator is defined)

- Add a badge to the Settings/Profile tab icon using `notifications.unreadCount` with `refetchInterval: 30_000`
- Simple red dot or count badge on the tab icon

#### 4. Notification List Screen
**File**: `apps/native/app/notifications.tsx` (or wherever screens are defined — depends on Expo Router structure)

- `FlatList` of notifications using `notifications.list`
- Each item: title, message, relative time, read/unread styling (bold for unread)
- Tap to mark as read
- "Mark All Read" button in header
- Accessible from Settings screen or profile tab

### Success Criteria

#### Automated Verification:
- [ ] TypeScript compiles: `pnpm -C apps/native tsc --noEmit`
- [ ] App builds without errors: `pnpm -C apps/native expo export --platform ios` (dry run)

#### Manual Verification:
- [ ] Open exercise picker in native app — "Can't find?" link visible
- [ ] Tap it — create custom exercise sheet slides up
- [ ] Fill out form with linked exercise — submit succeeds
- [ ] Check notifications tab — approval notification appears after admin approves (on web)
- [ ] Notification badge shows on tab bar

**Pause here for manual confirmation.**

---

## Testing Strategy

### Unit Tests
- `admin.approveExercise`: verify transaction atomicity — exercise is promoted AND notification is created, or neither
- `admin.approveExercise`: verify it rejects if exercise is not pending (idempotency)
- `admin.rejectExercise`: verify status change + notification creation
- `notifications.unreadCount`: verify count accuracy after mark-read
- `exercises.createCustom`: verify `status` defaults to `pending`, `linkedExerciseId` is stored

### Integration Tests
- Full flow: create custom exercise -> admin approve -> notification created -> exercise visible to all users
- Full flow: create custom exercise -> admin reject -> notification created -> exercise still only visible to creator

### Manual Testing Steps
1. Create a custom exercise "Zercher Squat" linked to "Front Squat"
2. Verify it appears only in the creator's exercise list
3. As admin, approve it
4. Verify it appears in all users' exercise lists
5. Verify the creator received a notification
6. Create another custom exercise and reject it — verify notification

## Performance Considerations

- **Notification polling**: 30-second `refetchInterval` is lightweight. If the app scales significantly, consider switching to server-sent events or WebSocket subscriptions.
- **Pending exercises query**: Admin query joins `exercise` + `user` filtered by `status = 'pending'`. The `exercise_status_idx` index covers this. Volume will be low (human-submitted exercises).
- **Notification count query**: Uses `notification_userId_readAt_idx` composite index — efficient for the `WHERE userId = ? AND readAt IS NULL` pattern.
- **Exercise search**: Already uses `ilike` with the existing `exercise_name_idx`. No additional indexing needed.

## Migration Notes

- **Existing custom exercises**: The migration adds `status` as a nullable column. Existing custom exercises will have `status = NULL`. You should run a one-time data migration to set `status = 'approved'` for all existing `isCustom = true` exercises (since they were created before the approval workflow existed and should continue to work):

```sql
UPDATE exercise SET status = 'approved' WHERE is_custom = true AND status IS NULL;
```

Add this as a post-migration step or include it in the Drizzle migration SQL.

- **`linkedExerciseId`**: Added as nullable with `ON DELETE SET NULL` — safe for existing data.
- **`notification` table**: Brand new, no data migration needed.
- **No breaking changes**: The `exercises.list` and `exercises.search` queries continue to work as before. Custom exercises with any status still appear for their creator. The `isCustom` flag still controls public visibility.

## References

- Exercise schema: `packages/db/src/schema/exercise.ts`
- Exercise router: `packages/api/src/routers/exercises.ts`
- Admin router: `packages/api/src/routers/admin.ts`
- tRPC setup (adminProcedure): `packages/api/src/index.ts`
- Web exercise picker: `apps/web/src/components/workout/exercise-picker.tsx`
- Native exercise picker: `apps/native/components/workout/exercise-picker.tsx`
- Web header: `apps/web/src/components/header.tsx`
- Drizzle migrations: `packages/db/src/migrations/`
