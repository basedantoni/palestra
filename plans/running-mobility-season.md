# Plan: Running & Mobility Season

> Source PRD: PRD - Running and Mobility Season.md

## Architectural Decisions

- **Schema**: No migrations for workout/log tables — all cardio fields already exist on `exercise_log`. Only additive change: `mobility` value added to `exercise_type` enum in Phase 1.
- **Logging model**: Cardio exercises use a single exercise log (no sets). Rounds + work/rest duration cover sprints/intervals. Distance + pace + HR cover runs. Duration + rounds cover mobility.
- **UI field rendering**: `ExerciseCard` replaces the sets table entirely with a cardio field panel when `exerciseType` is `cardio`, `hiit`, or `mobility`. No sets rendered for these types.
- **Laterality**: Not tracked. Bilateral mobility exercises log once (rounds × duration_seconds).
- **Templates**: Multi-exercise templates with `default_sets = null` for all cardio/mobility exercises.
- **Analytics**: Running + mobility analytics live as a new tab/section on the existing Analytics page.
- **PRs**: Two record types per run exercise — longest distance and fastest pace. Checked and inserted on `workouts.create`.
- **Scope**: Web only. Native app is a follow-on.

---

## Phase 1: Data Foundation

**User stories**: 1–6, 20–26

### What to build

Add `mobility` to the `exercise_type` enum with a Drizzle migration. Seed a comprehensive running exercise library and a comprehensive mobility exercise library as system exercises. Seed 5 multi-exercise system templates: Sprint Session, Short Run, Long Run, Interval Session, Full-Body Mobility. All seeding is idempotent using the existing deterministic UUID pattern.

> Implementation status (2026-04-23): Phase 1 is verified in the local DB. A same-day follow-up corrected interval-style running exercises to seed as `exerciseType: hiit`, and re-running the seed now repairs existing system rows in place.

**Running exercises to seed:**
Sprint, Short Run, Long Run, Interval Run, Tempo Run, Recovery Run, Warm Up Run, Cool Down Run, Hill Sprint, Fartlek Run, Progression Run, Strides, 400m Repeat, 800m Repeat, Mile Repeat, Treadmill Run, Trail Run

**Mobility exercises to seed:**
Hip Flexor Stretch, Pigeon Pose, 90/90 Hip Stretch, Hip Circle, Lateral Hip Stretch, Butterfly Stretch, Frog Stretch, Couch Stretch, Hamstring Stretch, Seated Hamstring Stretch, Glute Bridge, Figure Four Stretch, Supine Hamstring Stretch, Calf Stretch, Soleus Stretch, Ankle Circle, Ankle Dorsiflexion Stretch, Standing Quad Stretch, Lying Quad Stretch, Cat-Cow, Child's Pose, Supine Twist, Cobra, Knee to Chest Stretch, Thoracic Rotation, Thread the Needle, Thoracic Extension, Lat Stretch, Doorway Chest Stretch, Shoulder Cross-Body Stretch, Sleeper Stretch, Neck Lateral Flexion, World's Greatest Stretch, Inchworm, Leg Swing (Front-Back), Leg Swing (Lateral), Hip Opener Walk, Deep Squat Hold, Lunge with Rotation

**System templates:**

| Template | Workout Type | Exercises |
|---|---|---|
| Sprint Session | hiit | Warm Up Run → Sprint → Cool Down Run |
| Short Run | cardio | Warm Up Run → Short Run → Cool Down Run |
| Long Run | cardio | Warm Up Run → Long Run → Cool Down Run |
| Interval Session | hiit | Warm Up Run → Interval Run → Strides → Cool Down Run |
| Full-Body Mobility | yoga (→ mobility post-migration) | Cat-Cow → World's Greatest Stretch → Hip Flexor Stretch → Pigeon Pose → 90/90 Hip Stretch → Thoracic Rotation → Hamstring Stretch → Couch Stretch → Child's Pose → Supine Twist |

### Acceptance criteria

- [x] `mobility` value exists in the `exercise_type` enum in the database
- [x] All 17 running exercises appear in the exercise picker (system exercises, not custom)
- [x] All 39 mobility exercises appear in the exercise picker tagged as `mobility` type
- [x] Running exercises are tagged `category: cardio`, with interval-style entries using `exerciseType: hiit`
- [x] 5 system templates appear in the template picker
- [x] Each template loads with correct ordered exercises
- [x] `default_sets` is null for all cardio/mobility template exercises
- [x] Seed script is idempotent — re-running does not duplicate records

---

## Phase 2: Cardio Workout Logging (Web)

**User stories**: 7–19, 27

### What to build

Update `ExerciseCard` to detect exercise type and render a cardio field panel instead of the sets table when the exercise is `cardio`, `hiit`, or `mobility`. The panel adapts based on workout type:

> Implementation status (2026-04-23): Phase 2 is fully verified. A same-day regression in sprint exercise typing was corrected in the seed data, the local DB was reseeded, and manual web verification passed after the fix.

- **Cardio (runs)**: distance, duration, pace, heart rate, intensity, notes
- **HIIT (sprints/intervals)**: rounds, work duration, rest duration, intensity, notes
- **Mobility**: rounds, duration per round, notes

Pace can be entered manually or auto-calculated from distance + duration. All fields map directly to existing `exercise_log` columns — no API changes needed.

Update the workout form to pass `exerciseType` into `ExerciseCard` so it can gate rendering. Verify full round-trip: create workout with cardio logs → fetch workout → all fields returned correctly.

### Acceptance criteria

- [x] Logging a Long Run shows: distance, duration, pace, heart rate, intensity, notes — no sets table
- [x] Logging a Sprint Session shows: rounds, work duration, rest duration, intensity, notes — no sets table
- [x] Logging a Mobility session shows: rounds, duration per round, notes — no sets table
- [x] Weightlifting exercises still render the sets table unchanged
- [x] Pace auto-calculates from distance + duration when both are entered
- [x] All cardio fields persist correctly on save and reload
- [x] Starting from a running or mobility template pre-fills exercise type and renders correct fields
- [x] User can add notes to any cardio or mobility exercise log
- [x] Integration test: create cardio workout via tRPC, fetch it, assert all cardio fields round-trip correctly

---

## Phase 3: Analytics, PRs, and Dashboard

**User stories**: 28–40

### What to build

> Implementation status (2026-04-23): code changes are in place and automated verification passed. The running PR path uses the existing `best_pace` enum value for fastest pace records. The acceptance checkboxes below remain unchecked until manual web verification is completed.

**New tRPC analytics procedures:**
- `analytics.weeklyRunningVolume` — total distance (in user's distance unit) and total time per week, filterable by date range. Returns one row per week.
- `analytics.runningPaceTrend` — average pace over time per exercise, optionally filtered by exercise ID. Returns chronological data points.
- `analytics.mobilityFrequency` — mobility session count and total duration (minutes) per week.
- `analytics.workoutTypeMix` — weekly breakdown of workout counts by `workout_type`.

**PR detection for runs:**
Extend the PR detection logic (called on `workouts.create`) to check two record types per cardio exercise log: longest `distance` and fastest `pace`. Insert into `personal_record` using existing `record_type` + `value` fields if a new best is found.

**Analytics page — new Running & Mobility tab/section:**
- Weekly mileage bar chart (distance per week)
- Pace trend line chart per run exercise
- Run type breakdown (sprint / short / long / interval weekly counts)
- Mobility frequency (sessions per week + total duration)
- PR display for distance and pace per exercise

**Dashboard updates:**
- Running summary widget: weekly distance, weekly run count
- Mobility summary widget: sessions this week, total weekly duration

**Workout history:**
- Add type filter (All / Running / Mobility / Lifting / other types) — pill or dropdown

### Acceptance criteria

- [ ] `weeklyRunningVolume` returns correct distance and time totals grouped by week
- [ ] `runningPaceTrend` returns pace data points in chronological order per exercise
- [ ] `mobilityFrequency` returns correct session count and duration per week
- [ ] `workoutTypeMix` returns correct weekly workout counts by type
- [ ] Logging a run with a new best pace creates a `personal_record` row (type: best_pace)
- [ ] Logging a run with a new best distance creates a `personal_record` row (type: longest_distance)
- [ ] Analytics page has a Running & Mobility tab/section showing all four chart types
- [ ] Pace values respect user's `distanceUnit` preference (min/mi vs min/km)
- [ ] Dashboard shows weekly running distance + run count widget
- [ ] Dashboard shows weekly mobility sessions + duration widget
- [ ] Workout history filter correctly narrows list by workout type
- [ ] Unit tests for weekly aggregation logic (empty input, multi-week, null values)
