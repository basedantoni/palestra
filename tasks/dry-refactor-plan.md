# DRY / Complexity Refactor Implementation Plan

## Overview

Eleven concrete DRY and complexity findings across the fitness-app monorepo, grouped into two phases:

- **Phase 1** — leaf helper extractions, two bug fixes (Finding 4: `mobility` enum, Finding 8: native PR omissions), CSS typo fix (Finding 7). Safe, mechanical.
- **Phase 2** — structural refactors (component decomposition, declarative projection table, state relocation). Depends on Phase 1 helpers.

Every step is independently testable via TypeScript compile + existing test suite.

---

## Phase 1: Leaf Helpers, Bug Fixes, Single-File Extractions

**Recommended PR order (minimize merge conflicts):**
1. Finding 7A (typo) — pure search/replace, do first
2. Finding 5 (date utils) — small blast radius
3. Finding 1 (`getEffectiveDurationSeconds`)
4. Finding 4 (`workoutTypeEnum` + `mobility` bug)
5. Finding 3 (chart formatters)
6. Finding 8 (PR formatters + native bug fixes)
7. Finding 6 (workouts.ts internal helpers)
8. Finding 7B (chart primitives wrapper)

---

### Finding 1 — `getEffectiveDurationSeconds` helper
**Impact: cross-app (web + api). Fixes the pattern that caused 3 separate coalesce fixes.**

- [ ] Add to `packages/api/src/lib/workout-utils.ts`:
  ```ts
  export function getEffectiveDurationSeconds(
    log: { durationSeconds?: number | null; durationMinutes?: number | null }
  ): number | null {
    if (log.durationSeconds != null) return log.durationSeconds;
    if (log.durationMinutes != null) return log.durationMinutes * 60;
    return null;
  }
  ```
- [ ] Replace at `apps/web/src/routes/workouts/$workoutId.tsx:511-516` (whoopRunningLog construction)
- [ ] Replace at `apps/web/src/routes/workouts/$workoutId.tsx:852` (Duration cell)
- [ ] Replace at `apps/web/src/routes/workouts/$workoutId.tsx:856` (Pace cell)
- [ ] Replace at `packages/api/src/routers/analytics.ts:526-533` (whoopPaceTrend)

---

### Finding 4 — Single `workoutTypeEnum` source of truth + `mobility` bug fix
**Impact: cross-cutting, 6 routers. `whoop.ts` currently omits `"mobility"` — behavioral bug.**

- [ ] Export `workoutTypeEnum` from `packages/db/src/schema/index.ts` (or `packages/shared`)
- [ ] Delete local `z.enum([...])` declarations and import canonical enum in:
  - [ ] `packages/api/src/routers/workouts.ts`
  - [ ] `packages/api/src/routers/templates.ts`
  - [ ] `packages/api/src/routers/admin.ts`
  - [ ] `packages/api/src/routers/analytics.ts`
  - [ ] `packages/api/src/routers/whoop.ts` — **two call sites, both missing `"mobility"`. Replacing fixes the bug.**
  - [ ] `packages/api/src/routers/import.ts` — two call sites
- [ ] Add regression test: `whoop.ts` accepts `type: "mobility"` without validation error

---

### Finding 5 — Canonical date helpers
**Impact: api only. Two helpers have different TZ correctness behavior — one is subtly wrong.**

- [ ] Create `packages/api/src/lib/date-utils.ts`:
  - `toLocalNoon(date: Date | string): Date` — the canonical TZ-safe version
  - `toLocalDateKey(date: Date | string): string` — returns `YYYY-MM-DD` in local TZ
  - `toDateString(date: Date): string`
  - Add comment documenting the "noon trick" DST invariant
- [ ] Delete `toLocalDateKey` at `packages/api/src/routers/analytics.ts:28-32`
- [ ] Delete `toLocalNoon`, `toDateString` at `packages/api/src/lib/analytics-queries.ts:13-31`
- [ ] Delete `normalizeDateToLocalNoon` at `packages/api/src/lib/workout-utils.ts:134-144`
- [ ] Re-export from `@src/api` lib barrel
- [ ] Add unit tests for DST boundary behavior (Mar/Nov US dates)

---

### Finding 3 — Shared chart formatters
**Impact: cross-app. 9 web + 3 native chart files. Formatters already drifting in signature.**

- [ ] Create `packages/api/src/lib/chart-formatters.ts`:
  - `formatDateLabel(date: Date | string): string`
  - `formatWeekLabel(weekStart: Date | string): string`
  - `formatPeriodLabel(period: string): string`
  - `formatPaceFromSecondsPerUnit(secPerUnit: number): string` — M:SS format
  - `formatDuration(seconds: number): string`
- [ ] Re-export from `@src/api`
- [ ] Delete local definitions and import from `@src/api` in (web):
  - [ ] `apps/web/src/components/analytics/whoop-hr-trend-chart.tsx`
  - [ ] `apps/web/src/components/analytics/whoop-pace-trend-chart.tsx`
  - [ ] `apps/web/src/components/analytics/whoop-weekly-distance-chart.tsx`
  - [ ] `apps/web/src/components/analytics/running-pace-trend-chart.tsx`
  - [ ] `apps/web/src/components/analytics/running-volume-chart.tsx`
  - [ ] `apps/web/src/components/analytics/volume-over-time-chart.tsx`
  - [ ] `apps/web/src/components/analytics/mobility-frequency-chart.tsx`
  - [ ] `apps/web/src/components/analytics/workout-type-mix-chart.tsx`
  - [ ] `apps/web/src/components/analytics/muscle-group-chart.tsx`
- [ ] Delete local definitions and import from `@src/api` in (native):
  - [ ] `apps/native/components/analytics/NativeWhoopHrTrend.tsx`
  - [ ] `apps/native/components/analytics/NativeWhoopWeeklyDistance.tsx`
  - [ ] `apps/native/components/analytics/NativeVolumeChart.tsx`

---

### Finding 8 — Shared PR formatters + native bug fixes
**Impact: cross-app. Native missing `best_pace` label and `distanceUnit` param — both fixed during migration.**

- [ ] Create `packages/api/src/lib/pr-formatters.ts`:
  - `RECORD_TYPE_LABELS` — must include `best_pace`
  - `formatPrValue(record, distanceUnit: "mi" | "km"): string`
  - `formatPrDelta(delta, recordType, distanceUnit: "mi" | "km"): string`
  - `isPrImprovement(recordType: string, delta: number): boolean`
- [ ] Replace usages in `apps/web/src/components/analytics/personal-records-grid.tsx:25-70`
- [ ] Replace usages in `apps/native/components/analytics/NativePersonalRecords.tsx:25-54` — **fixes `best_pace` and `distanceUnit` omissions**

---

### Finding 7 — CSS typo fix + chart primitives
**Impact: web only. All 9 chart files have `"var(--muted-foreground"` missing closing `)` — broken CSS silently ignored.**

**Part A — typo fix (immediate):**
- [ ] Replace `labelStyle={{ color: "var(--muted-foreground" }}` with `labelStyle={{ color: "var(--muted-foreground)" }}` in all 9 web chart files

**Part B — chart primitives wrapper:**
- [ ] Create `apps/web/src/components/ui/chart-primitives.tsx` exporting:
  - `<AppCartesianGrid />` — `strokeDasharray="3 3" stroke="var(--border)"` baked in
  - `<AppXAxis />` — `tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}` baked in
  - `<AppYAxis />` — same
  - `<AppTooltip />` — correct `labelStyle` baked in, impossible to typo
- [ ] Migrate all 9 charts to use primitives; delete repeated prop blobs

---

### Finding 6 — Workout router internal helpers
**Impact: api only, single file. Schema changes currently require editing two places.**

- [ ] In `packages/api/src/routers/workouts.ts`, extract:
  - `async function insertExerciseLogsAndSets(tx, workoutId, logs)` — replaces ~60 duplicated lines at 324-367 (create) and 461-495 (update)
  - `function runFireAndForgetRecalcs(userId, exerciseIds, date)` — replaces duplicated blocks at 421-429 and 510-517
- [ ] Replace both call sites in `create` and `update`

---

### Phase 1 Success Criteria

- [ ] `pnpm typecheck` passes: `packages/shared`, `packages/api`, `packages/db`, `apps/web`, `apps/native`
- [ ] `pnpm test` passes
- [ ] `grep -r "var(--muted-foreground\"" apps/web/src/components/analytics/` returns zero results
- [ ] No remaining duplicate definitions of: coalesce pattern, workout-type `z.enum`, date helpers, chart formatters, PR formatters
- [ ] Manual: workout detail duration/pace correct for Whoop-linked runs
- [ ] Manual: analytics charts render correctly with correct tooltips
- [ ] Manual: native PR grid shows `best_pace` label (not raw key)
- [ ] Manual: Whoop sync accepts a `mobility` workout without error

---

## Phase 2: Structural Refactors

*Depends on Phase 1 helpers being in place.*

---

### Finding 2 — Extract shared HrZone constants + `useWhoopLinking` hook
**Impact: cross-app. ~340 lines cloned between web and native workout detail.**

- [ ] Add to `packages/shared`:
  - `HR_ZONE_COLORS`, `HR_ZONE_LABELS`, `interface HrZoneDurations`
  - `computeZonePercents(durations: HrZoneDurations): Record<Zone, number>`
- [ ] Create `apps/web/src/hooks/use-whoop-linking.ts` — wraps tRPC mutations, exposes `{ link, unlink, isLinking, candidates }`
- [ ] Create `apps/native/hooks/useWhoopLinking.ts` — same shape
- [ ] Update `apps/web/src/routes/workouts/$workoutId.tsx:60-364` to use shared constants + hook
- [ ] Update `apps/native/app/workout-detail/[id].tsx:38-372` to use shared constants + hook
- [ ] Use `getEffectiveDurationSeconds` from Finding 1 inside linking flow

---

### Finding 9 — Decompose `$workoutId.tsx` (962 lines)
**Impact: web only. Single file doing 8+ jobs.**

- [ ] Create `apps/web/src/routes/workouts/-components/WorkoutViewMode.tsx` — pure render, props: `{ workout, distanceUnit }`
- [ ] Create `apps/web/src/routes/workouts/-components/WorkoutEditMode.tsx` — owns `formData` state, handlers, `onSaved`/`onCancel`
- [ ] Create `apps/web/src/routes/workouts/-components/LoggedExerciseCard.tsx` — per-exercise-type render (cardio/hiit/mobility/sets)
- [ ] Create `apps/web/src/routes/workouts/-hooks/useWorkoutFirstRunningLog.ts` — returns coalesced `{ log, durationSeconds, paceSecondsPerKm }`
- [ ] Slim `$workoutId.tsx` to thin route component switching between view/edit + mounting WhoopSection/HrZoneChart
- [ ] Target: every new file < 250 lines

---

### Finding 10 — Declarative `EXERCISE_TYPE_FIELD_CONFIG`
**Impact: web only. Eliminates 8-field nested ternaries in 3 sibling projection functions.**

- [ ] Add to `packages/api/src/lib/workout-utils.ts`:
  ```ts
  export const EXERCISE_TYPE_FIELD_CONFIG = {
    strength:  { fields: ["sets", "reps", "weight"],    ... },
    cardio:    { fields: ["distance", "durationSeconds", "durationMinutes", "pace"], ... },
    hiit:      { fields: ["rounds", "workDuration", "restDuration", ...], ... },
    mobility:  { fields: ["rounds", "durationMinutes", ...], ... },
  } satisfies Record<ExerciseType, ExerciseFieldConfig>;
  ```
- [ ] Rewrite `formDataToApiInput` (226-265) — declarative lookup, no nested ternaries
- [ ] Rewrite `apiWorkoutToFormData` (269-315) — symmetric inverse via same table
- [ ] Rewrite `templateToWorkoutFormData` (317-402) — same table
- [ ] Add round-trip tests: `apiWorkoutToFormData(formDataToApiInput(form))` is identity for each exercise type

---

### Finding 11 — Move running-pace selection state into chart
**Impact: web only. State, dedup memo, auto-init effect, filter memo all belong in the chart.**

- [ ] Move from `apps/web/src/components/analytics/analytics-dashboard.tsx:86-128` into `RunningPaceTrendChart`:
  - `selectedRunningExerciseId` state
  - Dedup memo (or remove if tRPC response returns pre-grouped data)
  - Auto-init effect
  - Filter memo
- [ ] Dashboard passes full `runningPaceTrend` dataset; chart owns picker UI
- [ ] Optional: extend `runningPaceTrend` response to include pre-deduped `exercises` array (additive, non-breaking)

---

### Phase 2 Success Criteria

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test` passes (including new round-trip tests for `EXERCISE_TYPE_FIELD_CONFIG`)
- [ ] `$workoutId.tsx` < 250 lines
- [ ] No nested ternaries in `formDataToApiInput`/`apiWorkoutToFormData`/`templateToWorkoutFormData`
- [ ] `analytics-dashboard.tsx` no longer references `selectedRunningExerciseId`
- [ ] Manual: view/edit mode switching works correctly
- [ ] Manual: each exercise type (strength, cardio, hiit, mobility) round-trips through form correctly
- [ ] Manual: HR zone chart identical pre/post on both platforms
- [ ] Manual: running pace picker defaults to most-recent exercise on dashboard load
- [ ] Manual: template-to-workout conversion produces identical form state
