# Analytics Dashboard Implementation Plan

## Overview

Build the analytics dashboard UI for both web (TanStack Router + Recharts) and native (Expo Router + Victory Native), backed by new backend queries for volume-over-time, workout frequency heatmap, and streak tracking. The backend is developed TDD-style with Vitest; the frontend is built after all queries pass.

## Current State Analysis

### What Exists

- **Analytics router** (`packages/api/src/routers/analytics.ts`): 4 endpoints
  - `personalRecords(exerciseId?)` — returns all PR rows for a user, but does NOT join exercise names
  - `progressiveOverload(exerciseId?)` — trend status + suggestion per exercise (joins exercise name)
  - `exerciseSuggestion(exerciseId)` — single exercise trend + suggestion
  - `muscleGroupVolume(startDate?, endDate?, categorizationSystem?)` — weekly volume by muscle group
- **DB tables**: `workout` (has `totalVolume`, `date`), `personalRecord` (has `previousRecordValue`), `muscleGroupVolume`, `progressiveOverloadState` (has `last10Workouts` JSONB)
- **Existing test patterns**: Vitest with `vitest.config.ts` in `packages/api/`, pure function tests in `packages/api/src/lib/progressive-overload.test.ts`
- **Web**: TanStack Router, shadcn/ui, tRPC via `createTRPCOptionsProxy`, no `/analytics` route yet
- **Native**: Expo Router tabs (`index`, `workouts`), HeroUI Native, no Analytics tab yet
- **No chart libraries installed** in either app

### What Is Missing

1. **Volume Over Time query** — no endpoint aggregates `workout.totalVolume` by week/month with filters
2. **Workout Frequency query** — no endpoint returns workout dates + volumes for heatmap rendering
3. **Streak query** — no endpoint calculates current/longest workout streaks
4. **`personalRecords` lacks exercise names** — needs a LEFT JOIN to `exercise` table
5. **Chart libraries** — Recharts (web), Victory Native (native) not installed
6. **Routes/tabs** — no `/analytics` web route, no native Analytics tab

### Key Discoveries

- `workout` table has `totalVolume: real` and `date: timestamp` with a composite index on `(userId, date)` — good for efficient aggregation (`packages/db/src/schema/workout.ts:39`)
- `personalRecord` has `previousRecordValue: real` for delta display (`packages/db/src/schema/personal-record.ts:28`)
- `muscleGroupVolume` has `weekStartDate: date` and `categorizationSystem` columns — already weekly-bucketed (`packages/db/src/schema/muscle-group-volume.ts:24-25`)
- The `progressiveOverloadState` table stores `last10Workouts` as JSONB — can be exposed for the detail view (`packages/db/src/schema/progressive-overload.ts:26`)
- Web tRPC pattern: `useQuery(trpc.analytics.xxx.queryOptions(...))` (see `apps/web/src/components/workout/use-exercise-suggestion.ts`)
- Native tRPC pattern: identical — `useQuery(trpc.analytics.xxx.queryOptions(...))` (see `apps/native/app/(drawer)/(tabs)/workouts.tsx:27`)
- Vitest config is minimal: `{ globals: true, environment: "node" }` (`packages/api/vitest.config.ts`)

## Desired End State

After this plan is complete:

1. The analytics router exposes 7 endpoints: the original 4 (with `personalRecords` enhanced) plus `volumeOverTime`, `workoutFrequency`, and `streaks`
2. All new endpoints have passing Vitest tests in `packages/api/src/routers/analytics.test.ts`
3. The web app has an `/analytics` route with 5 dashboard sections (volume chart, muscle group chart, PR grid, heatmap, overload status)
4. The native app has an Analytics tab with the same 5 sections
5. Chart libraries (Recharts for web, Victory Native for native) are installed and rendering

### Verification

- `pnpm -F @src/api test` passes all analytics tests
- `pnpm -F web check-types` passes with no errors
- Web: navigating to `/analytics` renders all 5 sections with data (or appropriate empty states)
- Native: tapping the Analytics tab renders all 5 sections

## What We Are NOT Doing

- **No UI tests** — TDD is scoped to the API layer only
- **No new database tables or migrations** — all data already exists in the current schema
- **No real-time updates** — analytics data refreshes on navigation, not via websockets
- **No export/share functionality** — no PDF or image export of charts
- **No custom date range picker component** — use existing `date-fns` utilities and simple select/input controls
- **No animations or chart transitions** — basic static chart rendering first

---

## Phase 1: New Backend Queries (TDD)

### Overview

Add 3 new queries and enhance 1 existing query on the analytics router using TDD. Write all failing tests first, then implement the queries to make them pass.

### 1A. Test Infrastructure

Since the new tests need to query the database through tRPC (integration-style), but the existing test pattern uses pure function tests, we will write the new tests as **pure SQL query function tests** — extracting the query logic into testable helper functions in a new file, then calling those from the router.

**File to create**: `packages/api/src/lib/analytics-queries.ts`
**Test file to create**: `packages/api/src/lib/analytics-queries.test.ts`

The query functions will be pure functions that accept a Drizzle `db` instance and parameters, making them testable with a real test database or mockable. However, since the existing codebase imports `db` directly from `@src/db` in the router (not dependency-injected), and the existing tests (`progressive-overload.test.ts`) test pure computation functions without DB access, we will follow the same pattern:

- Extract **pure transformation/aggregation logic** into testable functions
- Test the SQL query builders by testing their **output shape and transformation logic** on mock data
- The actual SQL execution stays in the router (untested at unit level, verified manually)

This keeps the TDD scope practical and consistent with the existing codebase patterns.

### 1B. Volume Over Time — Pure Helpers

**File**: `packages/api/src/lib/analytics-queries.ts`

New pure functions to create and test:

```ts
// Types
export interface VolumeDataPoint {
  period: string; // "2026-W09" or "2026-03"
  totalVolume: number;
  workoutCount: number;
}

export interface WorkoutFrequencyDay {
  date: string; // "2026-03-04"
  workoutCount: number;
  totalVolume: number | null;
  totalDurationMinutes: number | null;
}

export interface StreakResult {
  currentStreak: number;
  longestStreak: number;
  lastWorkoutDate: string | null;
}

// Pure functions
export function aggregateVolumeByWeek(
  workouts: Array<{ date: Date | string; totalVolume: number | null }>,
): VolumeDataPoint[];

export function aggregateVolumeByMonth(
  workouts: Array<{ date: Date | string; totalVolume: number | null }>,
): VolumeDataPoint[];

export function calculateStreaks(
  workoutDates: Array<string>, // sorted ascending, "YYYY-MM-DD"
  today: string, // "YYYY-MM-DD"
): StreakResult;

export function buildFrequencyMap(
  workouts: Array<{ date: Date | string; totalVolume: number | null; durationMinutes: number | null }>,
): WorkoutFrequencyDay[];

export function groupPersonalRecordsByExercise(
  records: Array<{
    exerciseId: string | null;
    exerciseName: string | null;
    recordType: string;
    value: number;
    previousRecordValue: number | null;
    dateAchieved: Date;
  }>,
): Array<{
  exerciseId: string;
  exerciseName: string;
  records: Array<{
    recordType: string;
    value: number;
    delta: number | null;
    dateAchieved: Date;
  }>;
}>;
```

### 1C. Test Cases (Red Phase)

**File**: `packages/api/src/lib/analytics-queries.test.ts`

Write these tests FIRST, all failing:

```ts
import { describe, it, expect } from "vitest";
import {
  aggregateVolumeByWeek,
  aggregateVolumeByMonth,
  calculateStreaks,
  buildFrequencyMap,
  groupPersonalRecordsByExercise,
} from "./analytics-queries";
```

#### `aggregateVolumeByWeek` tests:

1. **returns empty array for empty input**
2. **groups workouts into ISO weeks** — 3 workouts across 2 weeks returns 2 data points
3. **sums totalVolume within a week** — 2 workouts in same week with volumes 1000 and 1500 returns 2500
4. **skips workouts with null totalVolume** — counts them in workoutCount but does not add to totalVolume
5. **sorts output chronologically** — older weeks first
6. **formats period as ISO week string** — e.g., "2026-W09"

#### `aggregateVolumeByMonth` tests:

1. **returns empty array for empty input**
2. **groups workouts into calendar months** — workouts in Jan and Feb return 2 data points
3. **sums totalVolume within a month**
4. **formats period as "YYYY-MM"** — e.g., "2026-03"
5. **sorts output chronologically**

#### `calculateStreaks` tests:

1. **returns zeros for empty input** — `{ currentStreak: 0, longestStreak: 0, lastWorkoutDate: null }`
2. **single workout today returns streak of 1**
3. **consecutive days returns correct current streak** — workouts on Mon, Tue, Wed with today=Wed returns currentStreak=3
4. **gap breaks current streak** — workouts on Mon, Wed with today=Wed returns currentStreak=1 (Wed only)
5. **yesterday counts as continuing the streak** — workouts Mon, Tue, Wed with today=Thu returns currentStreak=3
6. **two days ago breaks current streak** — workouts Mon, Tue with today=Thu returns currentStreak=0
7. **longest streak is tracked separately** — 5-day streak in January, 2-day current streak returns longestStreak=5, currentStreak=2
8. **multiple workouts on same day count as one day** — 3 workouts on Monday = 1 day in streak
9. **returns lastWorkoutDate** — the most recent workout date

#### `buildFrequencyMap` tests:

1. **returns empty array for empty input**
2. **returns one entry per unique date**
3. **aggregates multiple workouts on same date** — sums volume, sums duration, increments count
4. **handles null volume and duration gracefully**
5. **sorts output by date ascending**

#### `groupPersonalRecordsByExercise` tests:

1. **returns empty array for empty input**
2. **groups records by exerciseId** — 3 records for 2 exercises returns 2 groups
3. **computes delta as value - previousRecordValue** — value=150, prev=140 returns delta=10
4. **delta is null when previousRecordValue is null** (first PR ever)
5. **filters out records with null exerciseId**
6. **uses exerciseName from the record**
7. **sorts records within each exercise by dateAchieved descending** (most recent first)

### 1D. Implementation (Green Phase)

**File**: `packages/api/src/lib/analytics-queries.ts`

Implement each function to make the tests pass. Use `date-fns` for date manipulation (already installed in `apps/web`, add to `packages/api` if needed):

```bash
pnpm -F @src/api add date-fns
```

Key implementation notes:

- `aggregateVolumeByWeek`: use `getISOWeek` and `getISOWeekYear` from `date-fns` to bucket workouts
- `aggregateVolumeByMonth`: use `format(date, "yyyy-MM")` to bucket
- `calculateStreaks`: iterate sorted dates, use `differenceInCalendarDays` to detect gaps
- `buildFrequencyMap`: use `format(date, "yyyy-MM-dd")` as key, accumulate per day
- `groupPersonalRecordsByExercise`: use a Map keyed by exerciseId, compute delta inline

### 1E. Router Enhancements

**File to modify**: `packages/api/src/routers/analytics.ts`

Add 3 new endpoints and enhance 1 existing:

#### New: `volumeOverTime`

```ts
volumeOverTime: protectedProcedure
  .input(
    z.object({
      granularity: z.enum(["weekly", "monthly"]),
      startDate: z.coerce.date().optional(),
      endDate: z.coerce.date().optional(),
      exerciseId: z.string().uuid().optional(),
      muscleGroup: z.string().optional(),
      workoutType: z.enum([
        "weightlifting", "hiit", "cardio", "calisthenics",
        "yoga", "sports", "mixed",
      ]).optional(),
    }),
  )
  .query(async ({ ctx, input }) => {
    // Query workout table with filters, then apply pure aggregation functions
    // SQL: SELECT date, total_volume FROM workout WHERE user_id = ? AND date >= ? AND date <= ?
    // Optional joins for exerciseId filter (through exercise_log) and workoutType filter
    // Then call aggregateVolumeByWeek or aggregateVolumeByMonth on the results
  }),
```

#### New: `workoutFrequency`

```ts
workoutFrequency: protectedProcedure
  .input(
    z.object({
      startDate: z.coerce.date().optional(), // defaults to 12 months ago
      endDate: z.coerce.date().optional(),   // defaults to today
    }).optional(),
  )
  .query(async ({ ctx, input }) => {
    // Query workouts in range, apply buildFrequencyMap
    // Also call calculateStreaks on the sorted dates
    // Return { days: WorkoutFrequencyDay[], streaks: StreakResult }
  }),
```

#### New: `streaks`

```ts
streaks: protectedProcedure
  .query(async ({ ctx }) => {
    // Query all workout dates for user (just the date column, very lightweight)
    // Apply calculateStreaks with today's date
    // Return StreakResult
  }),
```

#### Enhanced: `personalRecords`

Add a LEFT JOIN to the `exercise` table to include `exercise.name`:

```ts
personalRecords: protectedProcedure
  .input(/* same as before */)
  .query(async ({ ctx, input }) => {
    // Add: .leftJoin(exercise, eq(personalRecord.exerciseId, exercise.id))
    // Add: exercise.name to the select
    // Apply groupPersonalRecordsByExercise on the results
  }),
```

**Imports to add** at the top of `analytics.ts`:

```ts
import { workout } from "@src/db/schema/index";
import {
  aggregateVolumeByWeek,
  aggregateVolumeByMonth,
  calculateStreaks,
  buildFrequencyMap,
  groupPersonalRecordsByExercise,
} from "../lib/analytics-queries";
```

### Success Criteria

#### Automated Verification:
- [x] All tests pass: `pnpm -F @src/api test`
- [x] Type checking passes: `pnpm -F @src/api exec tsc --noEmit` (or via turbo `check-types`)

#### Manual Verification:
- [ ] Manually call each new endpoint via the tRPC panel or curl to confirm SQL executes correctly against a seeded database
- [ ] `volumeOverTime` returns correct weekly/monthly aggregations matching manual spot-checks
- [ ] `workoutFrequency` returns correct day-level data for the past 12 months
- [ ] `streaks` returns a plausible current and longest streak
- [ ] `personalRecords` now includes exercise names in the response

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation that the endpoints return correct data before proceeding to Phase 2.

---

## Phase 2: Web Analytics Route

### Overview

Create the `/analytics` web route with 5 dashboard sections using Recharts for charts and existing shadcn/ui components for layout.

### 2A. Install Recharts

```bash
pnpm -F web add recharts
```

### 2B. Add Navigation Link

**File to modify**: `apps/web/src/components/header.tsx`

Add Analytics to the nav links array:

```ts
const links = [
  { to: "/", label: "Home" },
  { to: "/dashboard", label: "Dashboard" },
  { to: "/workouts", label: "Workouts" },
  { to: "/analytics", label: "Analytics" },  // <-- ADD
] as const;
```

### 2C. Create Route File

**File to create**: `apps/web/src/routes/analytics.tsx`

Follow the same pattern as `dashboard.tsx` — `createFileRoute("/analytics")` with `beforeLoad` auth check and onboarding check.

```ts
import { createFileRoute, redirect } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";
import { AnalyticsDashboard } from "@/components/analytics/analytics-dashboard";

export const Route = createFileRoute("/analytics")({
  component: AnalyticsDashboard,
  beforeLoad: async ({ context }) => {
    const session = await authClient.getSession();
    if (!session.data) {
      redirect({ to: "/login", throw: true });
    }
    const isComplete = await context.queryClient.fetchQuery(
      context.trpc.preferences.isOnboardingComplete.queryOptions()
    );
    if (!isComplete) {
      redirect({ to: "/onboarding", throw: true });
    }
    return { session };
  },
});
```

### 2D. Component Breakdown

All new components live under `apps/web/src/components/analytics/`.

#### Component Tree

```
analytics-dashboard.tsx        (main container, tabs for sections)
  volume-over-time-chart.tsx   (Recharts LineChart)
  muscle-group-chart.tsx       (Recharts StackedBarChart)
  personal-records-grid.tsx    (shadcn Card grid)
  workout-heatmap.tsx          (custom calendar grid)
  overload-status-list.tsx     (reuses SuggestionBadge)
```

#### 1. `analytics-dashboard.tsx`

**File to create**: `apps/web/src/components/analytics/analytics-dashboard.tsx`

- Top-level layout component
- Uses shadcn `Tabs` to organize the 5 sections (or renders all in a scrollable page)
- Fetches all analytics data via tRPC hooks at this level, passes down to children
- Shows loading skeletons while data loads

**tRPC queries used:**
```ts
const volumeData = useQuery(
  trpc.analytics.volumeOverTime.queryOptions({
    granularity,
    startDate,
    endDate,
  })
);
const muscleGroupData = useQuery(
  trpc.analytics.muscleGroupVolume.queryOptions({
    startDate,
    endDate,
    categorizationSystem,
  })
);
const prData = useQuery(trpc.analytics.personalRecords.queryOptions());
const frequencyData = useQuery(trpc.analytics.workoutFrequency.queryOptions());
const overloadData = useQuery(trpc.analytics.progressiveOverload.queryOptions());
```

**Layout:** Single scrollable page with sections separated by `Separator`. Each section has a heading and the corresponding chart/component.

#### 2. `volume-over-time-chart.tsx`

**File to create**: `apps/web/src/components/analytics/volume-over-time-chart.tsx`

**Props:**
```ts
interface VolumeOverTimeChartProps {
  data: VolumeDataPoint[];
  granularity: "weekly" | "monthly";
  onGranularityChange: (g: "weekly" | "monthly") => void;
  isLoading: boolean;
}
```

**Implementation:**
- Recharts `ResponsiveContainer` + `LineChart`
- X-axis: period labels (week number or month name)
- Y-axis: volume (formatted with `formatVolume`)
- `Tooltip` showing exact volume + workout count
- Toggle buttons (shadcn `Button` group) for weekly/monthly
- Filter controls: exercise dropdown, workout type dropdown, date range (defer to simple selects, not a full date picker)

**Recharts components used:** `LineChart`, `Line`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`, `ResponsiveContainer`

#### 3. `muscle-group-chart.tsx`

**File to create**: `apps/web/src/components/analytics/muscle-group-chart.tsx`

**Props:**
```ts
interface MuscleGroupChartProps {
  data: Array<{
    weekStartDate: string;
    muscleGroup: string;
    totalVolume: number;
  }>;
  categorizationSystem: "bodybuilding" | "movement_patterns";
  onSystemChange: (s: "bodybuilding" | "movement_patterns") => void;
  isLoading: boolean;
}
```

**Implementation:**
- Recharts `BarChart` with stacked bars
- X-axis: week start dates
- Y-axis: volume
- One `Bar` per muscle group, stacked
- Color coding: assign a distinct color per muscle group
- Toggle button for bodybuilding vs movement_patterns system
- Legend showing muscle group colors

**Muscle group colors (bodybuilding):**
```ts
const MUSCLE_GROUP_COLORS: Record<string, string> = {
  chest: "#ef4444",
  back: "#3b82f6",
  shoulders: "#f59e0b",
  arms: "#8b5cf6",
  legs: "#10b981",
  core: "#ec4899",
};
```

**Muscle group colors (movement_patterns):**
```ts
const MOVEMENT_COLORS: Record<string, string> = {
  push: "#ef4444",
  pull: "#3b82f6",
  squat: "#10b981",
  hinge: "#f59e0b",
  carry: "#8b5cf6",
};
```

**Recharts components used:** `BarChart`, `Bar`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`, `Legend`, `ResponsiveContainer`

#### 4. `personal-records-grid.tsx`

**File to create**: `apps/web/src/components/analytics/personal-records-grid.tsx`

**Props:**
```ts
interface PersonalRecordsGridProps {
  data: Array<{
    exerciseId: string;
    exerciseName: string;
    records: Array<{
      recordType: string;
      value: number;
      delta: number | null;
      dateAchieved: Date;
    }>;
  }>;
  isLoading: boolean;
}
```

**Implementation:**
- Grid of shadcn `Card` components, one per exercise
- Each card shows exercise name as title
- Inside each card: list of PR badges (one per record type)
- Each badge shows: record type label, value, delta (e.g., "+10 lbs" in green, or "first PR" if no delta)
- Use shadcn `Badge` for record type labels

**Record type display labels:**
```ts
const RECORD_TYPE_LABELS: Record<string, string> = {
  max_weight: "Max Weight",
  max_reps: "Max Reps",
  max_volume: "Max Volume",
  best_pace: "Best Pace",
  longest_distance: "Longest Distance",
};
```

#### 5. `workout-heatmap.tsx`

**File to create**: `apps/web/src/components/analytics/workout-heatmap.tsx`

**Props:**
```ts
interface WorkoutHeatmapProps {
  days: WorkoutFrequencyDay[];
  streaks: StreakResult;
  isLoading: boolean;
}
```

**Implementation:**
- GitHub-style calendar heatmap (52 columns x 7 rows)
- Each cell = 1 day, color intensity based on `totalVolume` (or `workoutCount` if no volume)
- 5 intensity levels: none, low, medium, high, max (quantile-based from the data)
- Month labels along the top
- Day-of-week labels on the left (Mon, Wed, Fri)
- Tooltip on hover showing date, workout count, total volume
- Streak display: "Current streak: X days" and "Longest streak: Y days" shown above the heatmap
- Built with plain HTML/CSS grid (no extra library needed)

**Color palette (dark mode aware):**
```ts
const HEATMAP_COLORS = [
  "bg-muted",           // level 0: no workout
  "bg-emerald-200 dark:bg-emerald-900",  // level 1
  "bg-emerald-400 dark:bg-emerald-700",  // level 2
  "bg-emerald-500 dark:bg-emerald-500",  // level 3
  "bg-emerald-700 dark:bg-emerald-300",  // level 4 (max)
];
```

#### 6. `overload-status-list.tsx`

**File to create**: `apps/web/src/components/analytics/overload-status-list.tsx`

**Props:**
```ts
interface OverloadStatusListProps {
  data: Array<{
    exerciseId: string;
    exerciseName: string | null;
    trendStatus: string;
    plateauCount: number;
    suggestion: {
      type: string;
      message: string;
      details: { currentValue: number; suggestedValue: number; unit: string };
    } | null;
    lastCalculatedAt: Date;
  }>;
  isLoading: boolean;
}
```

**Implementation:**
- List of shadcn `Card` components, one per exercise
- Each card shows: exercise name, `SuggestionBadge` (reuse existing), suggestion message, last calculated date
- Sortable by trend status (improving first, then plateau, then declining)
- Clicking a card could expand to show the last 10 sessions (from `last10Workouts` JSONB) -- stretch goal, not required in this phase

**Reuses**: `apps/web/src/components/workout/suggestion-badge.tsx` (already exists)

### Success Criteria

#### Automated Verification:
- [x] Type checking passes: `pnpm -F web check-types`
- [ ] Build succeeds: `pnpm -F web build`

#### Manual Verification:
- [ ] Navigating to `/analytics` shows the full dashboard
- [ ] Volume Over Time chart renders with weekly/monthly toggle working
- [ ] Muscle Group chart renders with bodybuilding/movement_patterns toggle working
- [ ] Personal Records grid shows PRs grouped by exercise with delta values
- [ ] Heatmap renders last 12 months with correct color intensity
- [ ] Streak counters display correctly
- [ ] Overload status list shows all exercises with correct trend badges
- [ ] Empty states display correctly when no data exists
- [ ] Charts are responsive on different screen widths
- [ ] Header nav includes the Analytics link and highlights it when active

**Implementation Note**: After completing this phase and all verification passes, pause here for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Native Analytics Tab

### Overview

Add an Analytics tab to the native app with the same 5 sections, using Victory Native for charts.

### 3A. Install Victory Native

```bash
pnpm -F native add victory-native
```

Note: Victory Native depends on `react-native-svg` (already installed at `15.12.1` in `apps/native/package.json`) and `react-native-reanimated` (already installed at `~4.1.1`). No additional peer deps needed.

After install, restart Metro with cache clear:
```bash
cd apps/native && npx expo start --clear
```

### 3B. Add Analytics Tab

**File to modify**: `apps/native/app/(drawer)/(tabs)/_layout.tsx`

Add the Analytics tab to the Tabs component:

```tsx
<Tabs.Screen
  name="analytics"
  options={{
    title: "Analytics",
    tabBarIcon: ({ color, size }: { color: string; size: number }) => (
      <Ionicons name="stats-chart" size={size} color={color} />
    ),
  }}
/>
```

### 3C. Create Tab Screen

**File to create**: `apps/native/app/(drawer)/(tabs)/analytics.tsx`

Follow the same pattern as `workouts.tsx` — a `FlatList` with `ListHeaderComponent` containing the analytics sections.

**Important**: Do NOT wrap in `Container` (which uses `ScrollView`). Use `FlatList` or `ScrollView` directly with `useSafeAreaInsets` to avoid the VirtualizedList nesting error.

```tsx
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/utils/trpc";

import { NativeVolumeChart } from "@/components/analytics/NativeVolumeChart";
import { NativeMuscleGroupChart } from "@/components/analytics/NativeMuscleGroupChart";
import { NativePersonalRecords } from "@/components/analytics/NativePersonalRecords";
import { NativeWorkoutHeatmap } from "@/components/analytics/NativeWorkoutHeatmap";
import { NativeOverloadStatus } from "@/components/analytics/NativeOverloadStatus";
```

### 3D. Native Component Breakdown

All new components live under `apps/native/components/analytics/`.

#### Component Tree

```
NativeVolumeChart.tsx        (Victory Native VictoryChart + VictoryLine)
NativeMuscleGroupChart.tsx   (Victory Native VictoryChart + VictoryStack + VictoryBar)
NativePersonalRecords.tsx    (HeroUI Card list)
NativeWorkoutHeatmap.tsx     (custom View grid)
NativeOverloadStatus.tsx     (reuses SuggestionBadge)
```

#### 1. `NativeVolumeChart.tsx`

**File to create**: `apps/native/components/analytics/NativeVolumeChart.tsx`

**Props:** Same shape as web `VolumeOverTimeChartProps`.

**Implementation:**
- Victory Native `CartesianChart` with `Line` component
- X-axis: period labels
- Y-axis: volume
- Toggle buttons for weekly/monthly (use HeroUI `Button` or simple `Pressable`)
- Width: use `Dimensions.get("window").width - 48` for chart width

**Victory Native components:** `CartesianChart`, `Line`, `useChartPressState`

#### 2. `NativeMuscleGroupChart.tsx`

**File to create**: `apps/native/components/analytics/NativeMuscleGroupChart.tsx`

**Implementation:**
- Victory Native `CartesianChart` with `StackedBar` component
- Same color scheme as web
- Toggle for bodybuilding vs movement_patterns
- Manual legend using colored `View` circles + `Text`

#### 3. `NativePersonalRecords.tsx`

**File to create**: `apps/native/components/analytics/NativePersonalRecords.tsx`

**Implementation:**
- List of HeroUI `Card` components
- Each card: exercise name, list of record type + value + delta
- Delta shown as green "+X" text or "First PR" badge
- Similar layout to the workout cards in `workouts.tsx`

#### 4. `NativeWorkoutHeatmap.tsx`

**File to create**: `apps/native/components/analytics/NativeWorkoutHeatmap.tsx`

**Implementation:**
- Custom grid of small square `View` components (7 rows x 52 columns)
- Color intensity based on volume using the same quantile logic as web
- Render inside a horizontal `ScrollView` (since 52 columns is wider than screen)
- Month labels along the top
- Streak display above the grid: "Current streak: X days" / "Longest streak: Y days"
- Tap a cell to show a tooltip (use a state variable + absolute positioned `View`)

**Color palette (React Native):**
```ts
const HEATMAP_COLORS = [
  "#1f2937", // level 0: no workout (dark gray)
  "#065f46", // level 1
  "#059669", // level 2
  "#10b981", // level 3
  "#34d399", // level 4 (max)
];
```

#### 5. `NativeOverloadStatus.tsx`

**File to create**: `apps/native/components/analytics/NativeOverloadStatus.tsx`

**Implementation:**
- List of HeroUI `Card` components
- Reuses existing `SuggestionBadge` from `apps/native/components/workout/SuggestionBadge.tsx`
- Same layout as web version, adapted for mobile

### Success Criteria

#### Automated Verification:
- [x] TypeScript compiles: no errors in native app type check

#### Manual Verification:
- [ ] Analytics tab appears in the bottom tab bar with the stats-chart icon
- [ ] Tapping Analytics tab shows the full dashboard
- [ ] Volume chart renders and toggle between weekly/monthly works
- [ ] Muscle group chart renders and toggle between systems works
- [ ] Personal Records section shows grouped PRs with deltas
- [ ] Heatmap renders, scrolls horizontally, and tap-to-inspect works
- [ ] Streak counters display correctly
- [ ] Overload status list shows correct trend badges
- [ ] Empty states display correctly
- [ ] No VirtualizedList nesting warnings in the console
- [ ] Metro bundler resolves Victory Native without symlink errors

**Implementation Note**: After completing this phase and all verification passes, the analytics dashboard is complete.

---

## Implementation Order Summary

### Step-by-step sequence:

1. Install `date-fns` in `packages/api` (if not already there)
2. Create `packages/api/src/lib/analytics-queries.test.ts` with all failing tests
3. Run `pnpm -F @src/api test` -- confirm all new tests fail (red)
4. Create `packages/api/src/lib/analytics-queries.ts` with implementations
5. Run `pnpm -F @src/api test` -- confirm all tests pass (green)
6. Modify `packages/api/src/routers/analytics.ts` to add 3 new endpoints + enhance `personalRecords`
7. Run type check, manually verify endpoints against seeded DB
8. **PAUSE for manual verification of Phase 1**
9. Install `recharts` in `apps/web`
10. Create `apps/web/src/routes/analytics.tsx`
11. Create all 6 web components under `apps/web/src/components/analytics/`
12. Add nav link in `apps/web/src/components/header.tsx`
13. Run type check and build
14. **PAUSE for manual verification of Phase 2**
15. Install `victory-native` in `apps/native`
16. Add tab in `apps/native/app/(drawer)/(tabs)/_layout.tsx`
17. Create `apps/native/app/(drawer)/(tabs)/analytics.tsx`
18. Create all 5 native components under `apps/native/components/analytics/`
19. Restart Metro with `--clear`, verify on simulator
20. **PAUSE for manual verification of Phase 3**

## Files Created (New)

| File | Description |
|------|-------------|
| `packages/api/src/lib/analytics-queries.ts` | Pure functions for volume aggregation, streaks, frequency, PR grouping |
| `packages/api/src/lib/analytics-queries.test.ts` | Vitest tests for all pure functions (TDD) |
| `apps/web/src/routes/analytics.tsx` | Web analytics route |
| `apps/web/src/components/analytics/analytics-dashboard.tsx` | Main dashboard container |
| `apps/web/src/components/analytics/volume-over-time-chart.tsx` | Recharts line chart |
| `apps/web/src/components/analytics/muscle-group-chart.tsx` | Recharts stacked bar chart |
| `apps/web/src/components/analytics/personal-records-grid.tsx` | PR card grid |
| `apps/web/src/components/analytics/workout-heatmap.tsx` | Calendar heatmap |
| `apps/web/src/components/analytics/overload-status-list.tsx` | Overload trend list |
| `apps/native/app/(drawer)/(tabs)/analytics.tsx` | Native analytics tab screen |
| `apps/native/components/analytics/NativeVolumeChart.tsx` | Victory Native line chart |
| `apps/native/components/analytics/NativeMuscleGroupChart.tsx` | Victory Native stacked bar chart |
| `apps/native/components/analytics/NativePersonalRecords.tsx` | PR card list |
| `apps/native/components/analytics/NativeWorkoutHeatmap.tsx` | Calendar heatmap (View grid) |
| `apps/native/components/analytics/NativeOverloadStatus.tsx` | Overload trend list |

## Files Modified (Existing)

| File | Change |
|------|--------|
| `packages/api/src/routers/analytics.ts` | Add `volumeOverTime`, `workoutFrequency`, `streaks` endpoints; enhance `personalRecords` with exercise name JOIN and grouping |
| `apps/web/src/components/header.tsx` | Add Analytics nav link |
| `apps/native/app/(drawer)/(tabs)/_layout.tsx` | Add Analytics tab |

## Install Commands

```bash
# Phase 1: date-fns for API package
pnpm -F @src/api add date-fns

# Phase 2: Recharts for web
pnpm -F web add recharts

# Phase 3: Victory Native for native
pnpm -F native add victory-native
```

## References

- Analytics router: `packages/api/src/routers/analytics.ts`
- Progressive overload pure functions (test pattern to follow): `packages/api/src/lib/progressive-overload.test.ts`
- Web dashboard route (pattern to follow): `apps/web/src/routes/dashboard.tsx`
- Web suggestion badge (reusable): `apps/web/src/components/workout/suggestion-badge.tsx`
- Native tabs layout: `apps/native/app/(drawer)/(tabs)/_layout.tsx`
- Native suggestion badge (reusable): `apps/native/components/workout/SuggestionBadge.tsx`
- DB schemas: `packages/db/src/schema/workout.ts`, `personal-record.ts`, `muscle-group-volume.ts`, `progressive-overload.ts`
- Vitest config: `packages/api/vitest.config.ts`
