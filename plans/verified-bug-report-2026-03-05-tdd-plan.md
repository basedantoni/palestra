# TDD Implementation Plan: Verified Bugs (2026-03-05)

Skill used: `tdd` (task explicitly requested TDD planning).

## Scope

Fix all 14 confirmed bugs from:
`~/obsidian-vault/00 Projects/Fitness App/verified-bug-report-2026-03-05.md`

## Assumptions (to confirm before coding)

1. Public API contracts in `packages/api/src/routers` remain backward-compatible unless a bug requires change.
2. For date bugs, canonical storage/transport will use UTC-normalized day boundaries (or date-only strings where possible).
3. For UI-only bugs in `web`/`native`, we will add targeted component-level tests only where they protect regression-prone logic.
4. A DB migration for unique progressive overload constraint is acceptable.

## Current Test Surface

- Existing strong test surface: `packages/api` (Vitest already configured).
- Gap: `apps/web` and `apps/native` have no test scripts currently.
- Strategy: maximize early fixes in `packages/api` where TDD loop is fastest, then add minimal UI test harness for high-risk UI bugs.

## Prioritized Delivery Order

1. Critical data/security correctness: BUG-3, BUG-2, BUG-1.
2. Date/time correctness: BUG-5, BUG-6, BUG-9.
3. State-clobber/pagination UX correctness: BUG-4, BUG-7, BUG-11, BUG-10.
4. Config/validation polish: BUG-8, BUG-12, BUG-13, BUG-14.

## Phase 0: Test Harness and Guardrails

### Slice 0.1 (RED->GREEN)

- RED: add/confirm failing test command for API package (`pnpm -F @src/api test`).
- GREEN: ensure all existing tests run clean before bug work.

### Slice 0.2 (RED->GREEN, only if needed for UI bugs)

- RED: add minimal test setup for:
  - `apps/web` route/component behavior tests.
  - `apps/native` component logic tests (non-E2E).
- GREEN: one smoke test each package so later bug tests can run.

## Phase 1: Critical Bugs

### BUG-3 CSV Formula Injection (`packages/api/src/lib/export-utils.ts`)

### Tracer bullet

- RED: extend [`export-utils.test.ts`](/Users/anthony/dev/fitness-app/src/packages/api/src/lib/export-utils.test.ts) with one case: `=SUM(A1:A2)` must be neutralized.
- GREEN: update `escapeCsvValue` to prefix dangerous leading chars (`=`, `+`, `-`, `@`) before CSV escaping.

### Follow-up slices

- Test each leading char.
- Test values already quoted/with commas/newlines still serialize correctly.
- Test nullish/number behavior unchanged.

### BUG-2 Progressive Overload Upsert Race (`progressive-overload-db` + DB schema)

### Tracer bullet

- RED: add DB-level test proving duplicate `(userId, exerciseId)` state rows are prevented.
- GREEN: add unique constraint in [`progressive-overload.ts`](/Users/anthony/dev/fitness-app/src/packages/db/src/schema/progressive-overload.ts) and migration.

### Follow-up slices

- RED: test atomic upsert path on conflict updates existing row.
- GREEN: replace select-then-insert/update in [`progressive-overload-db.ts`](/Users/anthony/dev/fitness-app/src/packages/api/src/lib/progressive-overload-db.ts) with single upsert (`onConflictDoUpdate`).
- RED: test duplicate exercise IDs do not produce multiple DB writes in one run.
- GREEN: dedupe exercise IDs before processing.

### BUG-1 Native `Alert.prompt` Android break (`apps/native/app/workout-detail/[id].tsx`)

### Tracer bullet

- RED: add behavior test for save-as-template flow requiring cross-platform name entry without iOS-only API.
- GREEN: replace `Alert.prompt` with app-level modal/bottom-sheet input and submit callback.

### Follow-up slices

- Test trim + empty-name guard.
- Test mutation error path surfaces alert.

## Phase 2: Date/Time Correctness

### BUG-5 Calendar month boundary drift

- RED: add failing tests in [`workout-history-calendar.test.ts`](/Users/anthony/dev/fitness-app/src/packages/api/src/lib/workout-history-calendar.test.ts) for timezone boundary month edges.
- GREEN: standardize range semantics (UTC-normalized or date-only) in:
  - [`workout-history-calendar.ts`](/Users/anthony/dev/fitness-app/src/packages/api/src/lib/workout-history-calendar.ts)
  - [`workouts.ts`](/Users/anthony/dev/fitness-app/src/packages/api/src/routers/workouts.ts)

### BUG-6 New workout raw date storage drift

- RED: add tests in [`workout-utils.test.ts`](/Users/anthony/dev/fitness-app/src/packages/api/src/lib/workout-utils.test.ts) for selected date normalization.
- GREEN: normalize selected date in both:
  - [`apps/web/src/routes/workouts/new.tsx`](/Users/anthony/dev/fitness-app/src/apps/web/src/routes/workouts/new.tsx)
  - [`apps/native/app/new-workout.tsx`](/Users/anthony/dev/fitness-app/src/apps/native/app/new-workout.tsx)

### BUG-9 Streak/frequency UTC-vs-local mismatch

- RED: add failing local-day expectation tests in [`analytics-queries.test.ts`](/Users/anthony/dev/fitness-app/src/packages/api/src/lib/analytics-queries.test.ts) for users near UTC boundaries.
- GREEN: make day-key generation and “today” derivation consistent and user-local in:
  - [`analytics-queries.ts`](/Users/anthony/dev/fitness-app/src/packages/api/src/lib/analytics-queries.ts)
  - analytics router call sites that compute `today`.

## Phase 3: Form/Pagination/Theming UX Correctness

### BUG-4 Template edit form clobbering

- RED: test that user-edited fields are preserved when exercise catalog arrives late.
- GREEN: initialize once per template id + patch missing labels only in:
  - [`apps/web/src/routes/templates/$templateId.tsx`](/Users/anthony/dev/fitness-app/src/apps/web/src/routes/templates/$templateId.tsx)
  - native template detail equivalent.

### BUG-7 Native pagination replacing previous pages

- RED: test that loading page 2 appends rather than replaces page 1.
- GREEN: switch to infinite query or append+dedupe state in [`apps/native/app/(drawer)/(tabs)/workouts.tsx`](/Users/anthony/dev/fitness-app/src/apps/native/app/(drawer)/(tabs)/workouts.tsx).

### BUG-11 Template prefill one-shot leaves unknown names

- RED: test post-catalog reconciliation updates only unknown labels.
- GREEN: add reconciliation step in:
  - [`apps/web/src/routes/workouts/new.tsx`](/Users/anthony/dev/fitness-app/src/apps/web/src/routes/workouts/new.tsx)
  - [`apps/native/app/new-workout.tsx`](/Users/anthony/dev/fitness-app/src/apps/native/app/new-workout.tsx)
  - shared helper path in [`workout-utils.ts`](/Users/anthony/dev/fitness-app/src/packages/api/src/lib/workout-utils.ts) if applicable.

### BUG-10 Native `auto` theme not applied

- RED: test saving `auto` triggers runtime theme update path.
- GREEN: update success handler + theme context behavior in [`settings.tsx`](/Users/anthony/dev/fitness-app/src/apps/native/app/(drawer)/settings.tsx).

## Phase 4: Config and Validation Bugs

### BUG-8 Auth cookies local dev break

- RED: add config tests for env-conditional cookie attributes.
- GREEN: set cookie attributes conditionally in [`packages/auth/src/index.ts`](/Users/anthony/dev/fitness-app/src/packages/auth/src/index.ts).

### BUG-12 Duplicate exercise IDs recalc redundancy

- RED: test recalc called once per unique exercise ID for create/update flows.
- GREEN: dedupe IDs at call sites in [`workouts.ts`](/Users/anthony/dev/fitness-app/src/packages/api/src/routers/workouts.ts).

### BUG-13 Web save-as-template trim + error UX

- RED: test whitespace-only name blocked; API failure shows toast.
- GREEN: trim/validate and add `onError` handling in [`apps/web/src/routes/workouts/$workoutId.tsx`](/Users/anthony/dev/fitness-app/src/apps/web/src/routes/workouts/$workoutId.tsx).

### BUG-14 Native numeric input allows invalid values

- RED: test invalid reps/weight/rpe are blocked client-side before mutate.
- GREEN: add field constraints and validation messaging in [`apps/native/components/workout/exercise-card.tsx`](/Users/anthony/dev/fitness-app/src/apps/native/components/workout/exercise-card.tsx).

## Execution Rules (Strict TDD)

For every slice:

1. RED: write one failing behavior test.
2. GREEN: minimal code to pass.
3. REFACTOR: clean up only with tests green.
4. Commit small and isolated (`bug-id` scoped).

Do not batch “all tests first” or “all implementation first”.

## Suggested Work Breakdown (parallelizable)

1. Backend/API track: BUG-2,3,5,9,12,8.
2. Native UI track: BUG-1,6,7,10,14.
3. Web UI track: BUG-4,6,11,13.

## Acceptance Criteria

1. All added tests pass and reproduce prior bug before fix.
2. No regression in existing `@src/api` test suite.
3. Migration for BUG-2 is applied and verified against duplicate rows.
4. Manual verification checklist completed for native/web flows where automation is limited.

## Command Checklist

- `pnpm -F @src/api test`
- `pnpm check-types`
- package-specific test commands added in Phase 0 for `web`/`native` if required by chosen test harness.

