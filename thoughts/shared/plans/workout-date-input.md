# Workout Date Input Implementation Plan

## Overview

Add a date input to the new workout form so users can log past workouts. Currently the date is hardcoded to `new Date()` in `formDataToApiInput`. The API already accepts a `date` field -- this is purely a client-side form + shared utility change.

## Current State Analysis

- `WorkoutFormData` in `packages/api/src/lib/workout-utils.ts:41-53` has no `date` field
- `formDataToApiInput` in `packages/api/src/lib/workout-utils.ts:120` hardcodes `date: new Date()`
- The tRPC `workoutInput` schema in `packages/api/src/routers/workouts.ts:52` already accepts `date: z.coerce.date()` -- no backend changes needed
- Web form (`apps/web/src/routes/workouts/new.tsx:56-61`) initializes `WorkoutFormData` without a date
- Native form (`apps/native/app/new-workout.tsx:45-50`) same situation
- Existing test file `packages/api/src/lib/workout-utils.test.ts` has thorough tests for `formDataToApiInput`

### Key Discoveries:
- `packages/api/src/lib/workout-utils.ts:120` -- `date: new Date()` is the only place the date is set
- `packages/api/src/routers/workouts.ts:52` -- `z.coerce.date()` means string dates from the form will be coerced correctly
- `apps/web/src/components/ui/input.tsx` -- existing Input component accepts `type="date"` natively
- `apps/native/package.json` -- does NOT have `@react-native-community/datetimepicker` installed

## Desired End State

- `WorkoutFormData` has an optional `date` field (defaults to today when omitted)
- `formDataToApiInput` uses `form.date` if provided, falls back to `new Date()`
- Web form shows a date input defaulting to today, constrained to past/present dates
- Native form shows a date picker defaulting to today, constrained to past/present dates
- All existing tests pass; new tests cover the date-related logic

### Verification:
- `cd packages/api && pnpm test` passes (unit tests)
- Manual: create a workout with a past date on web, verify it appears with the correct date in the workout list
- Manual: same on native

## What We're NOT Doing

- No backend/schema changes (the API already accepts `date`)
- No date validation on the server (beyond what `z.coerce.date()` already does)
- No "future date" server-side rejection -- we just won't expose future dates in the UI
- No edit-workout date changes (that form can be updated separately)
- No date-based filtering or sorting changes

## Implementation Approach

TDD vertical slices: each slice is one test followed by its implementation. The testable logic lives in `workout-utils.ts` (the shared utility). The UI wiring on web and native is not unit tested -- it is verified manually.

---

## Phase 1: Add `date` to `WorkoutFormData` and `formDataToApiInput`

### Overview
Add the date field to the shared type and update the conversion function. This is the only testable logic change.

### TDD Slices

All tests go in `packages/api/src/lib/workout-utils.test.ts`. All implementation in `packages/api/src/lib/workout-utils.ts`.

#### Slice 1: `formDataToApiInput` uses provided date

**Test** (add to the existing `describe("formDataToApiInput", ...)` block):

```typescript
it("should use the provided date when set", () => {
  const customDate = new Date("2025-12-25");
  const formData: WorkoutFormData = {
    workoutType: "weightlifting",
    date: customDate,
    exercises: [
      {
        tempId: "ex-1",
        exerciseId: "bench-press-id",
        exerciseName: "Bench Press",
        order: 0,
        sets: [
          { tempId: "set-1", setNumber: 1, reps: 10, weight: 135, rpe: 7 },
        ],
        rounds: undefined,
        workDurationSeconds: undefined,
        restDurationSeconds: undefined,
        intensity: undefined,
        distance: undefined,
        durationSeconds: undefined,
        pace: undefined,
        heartRate: undefined,
        durationMinutes: undefined,
        notes: "",
      },
    ],
    notes: "",
    templateId: undefined,
  };

  const result = formDataToApiInput(formData);
  expect(result.date).toEqual(customDate);
});
```

**Implementation:**

1. Add `date?: Date` to `WorkoutFormData` interface (after `templateId`):

```typescript
export interface WorkoutFormData {
  workoutType: /* ... existing ... */;
  exercises: WorkoutExerciseFormData[];
  notes: string;
  templateId: string | undefined;
  date?: Date;  // <-- add this
}
```

2. Update `formDataToApiInput` to use it:

```typescript
export function formDataToApiInput(form: WorkoutFormData) {
  const exercises = form.exercises.filter(
    (ex) => ex.exerciseName.trim() !== "",
  );
  const totalVolume = calculateTotalVolume(exercises);

  return {
    date: form.date ?? new Date(),  // <-- changed from `new Date()`
    workoutType: form.workoutType,
    // ... rest unchanged
  };
}
```

#### Slice 2: `formDataToApiInput` defaults to today when date is omitted

**Test:**

```typescript
it("should default to approximately now when date is not provided", () => {
  const before = new Date();
  const formData: WorkoutFormData = {
    workoutType: "weightlifting",
    exercises: [
      {
        tempId: "ex-1",
        exerciseId: "bench-press-id",
        exerciseName: "Bench Press",
        order: 0,
        sets: [
          { tempId: "set-1", setNumber: 1, reps: 10, weight: 135, rpe: 7 },
        ],
        rounds: undefined,
        workDurationSeconds: undefined,
        restDurationSeconds: undefined,
        intensity: undefined,
        distance: undefined,
        durationSeconds: undefined,
        pace: undefined,
        heartRate: undefined,
        durationMinutes: undefined,
        notes: "",
      },
    ],
    notes: "",
    templateId: undefined,
    // date intentionally omitted
  };
  const after = new Date();

  const result = formDataToApiInput(formData);
  expect(result.date.getTime()).toBeGreaterThanOrEqual(before.getTime());
  expect(result.date.getTime()).toBeLessThanOrEqual(after.getTime());
});
```

This test should pass immediately after slice 1's implementation (the `?? new Date()` fallback). It serves as a regression guard for the default behavior.

### Changes Required:

#### 1. Type + function update
**File**: `packages/api/src/lib/workout-utils.ts`
- Add `date?: Date` to `WorkoutFormData` (line 53, before closing brace)
- Change line 120 from `date: new Date()` to `date: form.date ?? new Date()`

#### 2. Tests
**File**: `packages/api/src/lib/workout-utils.test.ts`
- Add two new tests inside the existing `describe("formDataToApiInput", ...)` block

### Success Criteria:

#### Automated Verification:
- [x] All tests pass: `cd packages/api && pnpm test`
- [x] Existing tests still pass (no regressions in the 6 existing `formDataToApiInput` tests)

#### Manual Verification:
- [ ] None needed for this phase -- it is pure logic

---

## Phase 2: Web UI date picker (shadcn Calendar + Popover)

### Overview
Add a shadcn date picker to the web new-workout form using `Calendar` + `Popover` components. Neither is installed yet — add them via the shadcn CLI first.

### Changes Required:

#### 1. Install shadcn components
Run from `apps/web`:
```bash
npx shadcn add calendar
npx shadcn add popover
```

This installs:
- `apps/web/src/components/ui/calendar.tsx` (uses `react-day-picker`)
- `apps/web/src/components/ui/popover.tsx` (uses `@radix-ui/react-popover`)

And adds `react-day-picker` + `@radix-ui/react-popover` to `apps/web/package.json`.

#### 2. Web new workout form
**File**: `apps/web/src/routes/workouts/new.tsx`

Add imports:
```typescript
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
```

Initialize `formData` with `date: new Date()`:
```typescript
const [formData, setFormData] = useState<WorkoutFormData>({
  workoutType: "weightlifting",
  exercises: [],
  notes: "",
  templateId: undefined,
  date: new Date(),
});
```

Add the date picker UI between the workout type selector and the separator:
```tsx
{/* Workout Date */}
<div className="mb-6">
  <Label>Date</Label>
  <Popover>
    <PopoverTrigger asChild>
      <Button
        variant="outline"
        className={cn(
          "w-[200px] justify-start text-left font-normal mt-1",
          !formData.date && "text-muted-foreground",
        )}
      >
        <CalendarIcon className="mr-2 h-4 w-4" />
        {formData.date ? format(formData.date, "PPP") : "Pick a date"}
      </Button>
    </PopoverTrigger>
    <PopoverContent className="w-auto p-0" align="start">
      <Calendar
        mode="single"
        selected={formData.date}
        onSelect={(date) => {
          if (date) setFormData({ ...formData, date });
        }}
        disabled={(date) => date > new Date()}
        autoFocus
      />
    </PopoverContent>
  </Popover>
</div>
```

Note: `date-fns` is a peer dependency of `react-day-picker` and will be available after the `npx shadcn add calendar` step. If not auto-installed, run `pnpm add date-fns` in `apps/web`.

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `cd apps/web && pnpm check-types`

#### Manual Verification:
- [ ] Date picker button appears on the new workout form, showing today's date
- [ ] Clicking it opens a Calendar popover
- [ ] Selecting a past date closes the popover and updates the button label
- [ ] Future dates are greyed out and unselectable
- [ ] Saving creates the workout with the selected date

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Native UI date picker

### Overview
Add a date picker to the React Native new-workout form. Since React Native has no native date input, install `@react-native-community/datetimepicker`.

### Changes Required:

#### 1. Install dependency
```bash
cd apps/native && pnpm add @react-native-community/datetimepicker
```

#### 2. Native new workout form
**File**: `apps/native/app/new-workout.tsx`

Add imports:

```typescript
import DateTimePicker from "@react-native-community/datetimepicker";
```

Initialize `formData` with `date: new Date()`:

```typescript
const [formData, setFormData] = useState<WorkoutFormData>({
  workoutType: "weightlifting",
  exercises: [],
  notes: "",
  templateId: undefined,
  date: new Date(),
});
```

Add state for showing the picker (Android needs modal behavior, iOS shows inline):

```typescript
const [showDatePicker, setShowDatePicker] = useState(Platform.OS === "ios");
```

Add the date picker UI after the workout type selector, before the exercises section:

```tsx
{/* Workout Date */}
<View className="px-4 pb-2">
  <Text className="text-sm font-medium text-foreground mb-2">Date</Text>
  {Platform.OS === "android" && (
    <Pressable onPress={() => setShowDatePicker(true)}>
      <Text className="text-foreground text-base py-2 px-3 border border-border rounded-lg">
        {(formData.date ?? new Date()).toLocaleDateString()}
      </Text>
    </Pressable>
  )}
  {showDatePicker && (
    <DateTimePicker
      value={formData.date ?? new Date()}
      mode="date"
      display={Platform.OS === "ios" ? "compact" : "default"}
      maximumDate={new Date()}
      onChange={(_event, selectedDate) => {
        setShowDatePicker(Platform.OS === "ios");
        if (selectedDate) {
          setFormData((prev) => ({ ...prev, date: selectedDate }));
        }
      }}
    />
  )}
</View>
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `cd apps/native && npx tsc --noEmit`

#### Manual Verification:
- [ ] Date picker appears on the new workout screen (iOS: inline compact picker, Android: tap to open modal)
- [ ] Default is today's date
- [ ] Future dates cannot be selected (`maximumDate` prevents it)
- [ ] Changing date and saving creates the workout with the selected date
- [ ] Pressing cancel / not changing the date still defaults to today

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding.

---

## Testing Strategy

### Unit Tests (in `packages/api/src/lib/workout-utils.test.ts`):
- `formDataToApiInput` uses a provided date -- verifies the date flows through
- `formDataToApiInput` defaults to now when date is omitted -- verifies backward compatibility

### What we are NOT unit testing:
- The HTML `<input type="date">` rendering (pure UI wiring, no logic)
- The React Native `DateTimePicker` rendering (pure UI wiring)
- The `max`/`maximumDate` constraint (browser/OS behavior, not our logic)
- The `toDateInputValue` helper (trivial formatting, tested implicitly by manual verification)

### Manual Testing Steps:
1. Open web app, go to New Workout
2. Verify date shows today by default
3. Change date to a past date, add an exercise, save
4. Verify the workout list shows the correct past date
5. Repeat steps 1-4 on native (iOS and Android)
6. Verify future dates cannot be selected on both platforms

## Performance Considerations

None -- a single date input has no performance implications.

## Migration Notes

None -- `WorkoutFormData.date` is optional, so all existing code that constructs a `WorkoutFormData` without a date continues to work unchanged. The `?? new Date()` fallback in `formDataToApiInput` preserves the current default behavior.

## References

- Shared utility: `packages/api/src/lib/workout-utils.ts`
- Existing tests: `packages/api/src/lib/workout-utils.test.ts`
- Web form: `apps/web/src/routes/workouts/new.tsx`
- Native form: `apps/native/app/new-workout.tsx`
- API schema: `packages/api/src/routers/workouts.ts:51-59`
- Web Input component: `apps/web/src/components/ui/input.tsx`
