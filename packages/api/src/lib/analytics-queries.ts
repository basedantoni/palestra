import { getISOWeek, getISOWeekYear, differenceInCalendarDays } from "date-fns";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Convert a Date or date string to a local Date at noon (to avoid DST issues).
 * When databases return timestamps, they're typically UTC midnight. We need
 * to interpret them in UTC to get the correct calendar date, then create a
 * local Date at noon so date-fns functions return the right day.
 */
function toLocalNoon(date: Date | string): Date {
  const d = typeof date === "string" ? new Date(date) : date;
  // Extract the UTC year/month/day and create a local Date at noon
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();
  return new Date(year, month, day, 12, 0, 0);
}

/**
 * Format a Date or date string as "yyyy-MM-dd" using UTC components.
 */
function toDateString(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getTodayLocalDateString(now = new Date()): string {
  return toDateString(now);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VolumeDataPoint {
  period: string; // "2026-W09" or "2026-03"
  totalVolume: number;
  workoutCount: number;
}

export interface WeeklyRunningVolumePoint {
  period: string;
  totalDistance: number;
  totalDurationSeconds: number;
  workoutCount: number;
}

export interface RunningPaceTrendPoint {
  date: string;
  exerciseId: string;
  exerciseName: string;
  averagePace: number;
  workoutCount: number;
}

export interface MobilityFrequencyPoint {
  period: string;
  sessionCount: number;
  totalDurationMinutes: number;
}

export interface WorkoutTypeMixPoint {
  period: string;
  workoutType:
    | "weightlifting"
    | "hiit"
    | "cardio"
    | "mobility"
    | "calisthenics"
    | "yoga"
    | "sports"
    | "mixed";
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

function toWeekPeriod(date: Date | string): string {
  const d = toLocalNoon(date);
  const weekNum = getISOWeek(d);
  const weekYear = getISOWeekYear(d);
  return `${weekYear}-W${String(weekNum).padStart(2, "0")}`;
}

function calculateCardioLogDurationSeconds(input: {
  durationSeconds?: number | null;
  rounds?: number | null;
  workDurationSeconds?: number | null;
  restDurationSeconds?: number | null;
}): number {
  if (input.durationSeconds != null) {
    return input.durationSeconds;
  }

  if (
    input.rounds != null &&
    (input.workDurationSeconds != null || input.restDurationSeconds != null)
  ) {
    return (
      input.rounds *
      ((input.workDurationSeconds ?? 0) + (input.restDurationSeconds ?? 0))
    );
  }

  return 0;
}

function calculateMobilityDurationMinutes(input: {
  durationMinutes?: number | null;
  durationSeconds?: number | null;
  rounds?: number | null;
}): number {
  if (input.durationMinutes != null) {
    return input.durationMinutes;
  }

  if (input.durationSeconds != null) {
    return ((input.rounds ?? 1) * input.durationSeconds) / 60;
  }

  return 0;
}

// ---------------------------------------------------------------------------
// aggregateVolumeByWeek
// ---------------------------------------------------------------------------

export function aggregateVolumeByWeek(
  workouts: Array<{ date: Date | string; totalVolume: number | null }>,
): VolumeDataPoint[] {
  const map = new Map<string, { totalVolume: number; workoutCount: number }>();

  for (const w of workouts) {
    const period = toWeekPeriod(w.date);
    const existing = map.get(period) ?? { totalVolume: 0, workoutCount: 0 };
    existing.workoutCount += 1;
    if (w.totalVolume != null) {
      existing.totalVolume += w.totalVolume;
    }
    map.set(period, existing);
  }

  return Array.from(map.entries())
    .map(([period, data]) => ({
      period,
      totalVolume: data.totalVolume,
      workoutCount: data.workoutCount,
    }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

// ---------------------------------------------------------------------------
// aggregateRunningVolumeByWeek
// ---------------------------------------------------------------------------

export function aggregateRunningVolumeByWeek(
  logs: Array<{
    date: Date | string;
    workoutId: string;
    distanceMeter: number | null;
    durationSeconds?: number | null;
    rounds?: number | null;
    workDurationSeconds?: number | null;
    restDurationSeconds?: number | null;
  }>,
): WeeklyRunningVolumePoint[] {
  const map = new Map<
    string,
    {
      totalDistance: number;
      totalDurationSeconds: number;
      workoutIds: Set<string>;
    }
  >();

  for (const log of logs) {
    const period = toWeekPeriod(log.date);
    const existing = map.get(period) ?? {
      totalDistance: 0,
      totalDurationSeconds: 0,
      workoutIds: new Set<string>(),
    };

    existing.totalDistance += log.distanceMeter ?? 0;
    existing.totalDurationSeconds += calculateCardioLogDurationSeconds(log);
    existing.workoutIds.add(log.workoutId);
    map.set(period, existing);
  }

  return Array.from(map.entries())
    .map(([period, data]) => ({
      period,
      totalDistance: Math.round(data.totalDistance * 100) / 100,
      totalDurationSeconds: data.totalDurationSeconds,
      workoutCount: data.workoutIds.size,
    }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

// ---------------------------------------------------------------------------
// aggregateRunningPaceTrend
// ---------------------------------------------------------------------------

export function aggregateRunningPaceTrend(
  logs: Array<{
    date: Date | string;
    workoutId: string;
    exerciseId: string;
    exerciseName: string;
    distanceMeter: number | null;
    durationSeconds: number | null;
  }>,
): RunningPaceTrendPoint[] {
  const map = new Map<
    string,
    {
      date: string;
      exerciseId: string;
      exerciseName: string;
      // pace stored as seconds per meter (unit-agnostic raw value)
      totalPaceSecsPerMeter: number;
      paceEntries: number;
      workoutIds: Set<string>;
    }
  >();

  for (const log of logs) {
    // Only include logs where pace can be derived
    if (
      log.distanceMeter == null ||
      log.distanceMeter <= 0 ||
      log.durationSeconds == null ||
      log.durationSeconds <= 0
    )
      continue;

    const paceSecsPerMeter = log.durationSeconds / log.distanceMeter;
    const date = toDateString(log.date);
    const key = `${date}:${log.exerciseId}`;
    const existing = map.get(key) ?? {
      date,
      exerciseId: log.exerciseId,
      exerciseName: log.exerciseName,
      totalPaceSecsPerMeter: 0,
      paceEntries: 0,
      workoutIds: new Set<string>(),
    };

    existing.totalPaceSecsPerMeter += paceSecsPerMeter;
    existing.paceEntries += 1;
    existing.workoutIds.add(log.workoutId);
    map.set(key, existing);
  }

  return Array.from(map.values())
    .map((item) => ({
      date: item.date,
      exerciseId: item.exerciseId,
      exerciseName: item.exerciseName,
      // averagePace in seconds per meter — callers convert to display unit
      averagePace:
        Math.round(
          (item.totalPaceSecsPerMeter / item.paceEntries) * 1e6,
        ) / 1e6,
      workoutCount: item.workoutIds.size,
    }))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.exerciseName.localeCompare(b.exerciseName),
    );
}

// ---------------------------------------------------------------------------
// aggregateMobilityFrequencyByWeek
// ---------------------------------------------------------------------------

export function aggregateMobilityFrequencyByWeek(
  logs: Array<{
    date: Date | string;
    workoutId: string;
    rounds?: number | null;
    durationSeconds?: number | null;
    durationMinutes?: number | null;
  }>,
): MobilityFrequencyPoint[] {
  const map = new Map<
    string,
    {
      totalDurationMinutes: number;
      workoutIds: Set<string>;
    }
  >();

  for (const log of logs) {
    const period = toWeekPeriod(log.date);
    const existing = map.get(period) ?? {
      totalDurationMinutes: 0,
      workoutIds: new Set<string>(),
    };

    existing.totalDurationMinutes += calculateMobilityDurationMinutes(log);
    existing.workoutIds.add(log.workoutId);
    map.set(period, existing);
  }

  return Array.from(map.entries())
    .map(([period, data]) => ({
      period,
      sessionCount: data.workoutIds.size,
      totalDurationMinutes:
        Math.round(data.totalDurationMinutes * 10) / 10,
    }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

// ---------------------------------------------------------------------------
// aggregateWorkoutTypeMixByWeek
// ---------------------------------------------------------------------------

export function aggregateWorkoutTypeMixByWeek(
  workouts: Array<{
    date: Date | string;
    workoutType: WorkoutTypeMixPoint["workoutType"];
  }>,
): WorkoutTypeMixPoint[] {
  const map = new Map<string, WorkoutTypeMixPoint>();

  for (const workout of workouts) {
    const period = toWeekPeriod(workout.date);
    const key = `${period}:${workout.workoutType}`;
    const existing = map.get(key) ?? {
      period,
      workoutType: workout.workoutType,
      workoutCount: 0,
    };
    existing.workoutCount += 1;
    map.set(key, existing);
  }

  return Array.from(map.values()).sort(
    (a, b) =>
      a.period.localeCompare(b.period) ||
      a.workoutType.localeCompare(b.workoutType),
  );
}

// ---------------------------------------------------------------------------
// aggregateVolumeByMonth
// ---------------------------------------------------------------------------

export function aggregateVolumeByMonth(
  workouts: Array<{ date: Date | string; totalVolume: number | null }>,
): VolumeDataPoint[] {
  const map = new Map<string, { totalVolume: number; workoutCount: number }>();

  for (const w of workouts) {
    const d = toLocalNoon(w.date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const period = `${year}-${month}`;

    const existing = map.get(period) ?? { totalVolume: 0, workoutCount: 0 };
    existing.workoutCount += 1;
    if (w.totalVolume != null) {
      existing.totalVolume += w.totalVolume;
    }
    map.set(period, existing);
  }

  return Array.from(map.entries())
    .map(([period, data]) => ({
      period,
      totalVolume: data.totalVolume,
      workoutCount: data.workoutCount,
    }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

// ---------------------------------------------------------------------------
// calculateStreaks
// ---------------------------------------------------------------------------

export function calculateStreaks(
  workoutDates: Array<string>, // sorted ascending, "YYYY-MM-DD"
  today: string, // "YYYY-MM-DD"
): StreakResult {
  if (workoutDates.length === 0) {
    return { currentStreak: 0, longestStreak: 0, lastWorkoutDate: null };
  }

  // Deduplicate dates (multiple workouts same day = 1 day)
  const uniqueDates = Array.from(new Set(workoutDates)).sort();
  const lastWorkoutDate = uniqueDates[uniqueDates.length - 1];

  // Helper: parse a "YYYY-MM-DD" date string as a local noon Date to avoid
  // timezone shifting when differenceInCalendarDays uses local time.
  const parseDay = (s: string): Date => {
    const parts = s.split("-").map(Number);
    return new Date(parts[0]!, parts[1]! - 1, parts[2]!, 12, 0, 0);
  };

  // Calculate current streak:
  // Streak is active if last workout was today or yesterday
  const todayDate = parseDay(today);
  const lastDate = parseDay(lastWorkoutDate!);
  const daysSinceLast = differenceInCalendarDays(todayDate, lastDate);

  let currentStreak = 0;
  if (daysSinceLast <= 1) {
    // Walk backwards from last date through consecutive days
    currentStreak = 1;
    for (let i = uniqueDates.length - 2; i >= 0; i--) {
      const curr = parseDay(uniqueDates[i + 1]!);
      const prev = parseDay(uniqueDates[i]!);
      if (differenceInCalendarDays(curr, prev) === 1) {
        currentStreak++;
      } else {
        break;
      }
    }
  }

  // Calculate longest streak
  let longestStreak = 1;
  let runningStreak = 1;
  for (let i = 1; i < uniqueDates.length; i++) {
    const curr = parseDay(uniqueDates[i]!);
    const prev = parseDay(uniqueDates[i - 1]!);
    if (differenceInCalendarDays(curr, prev) === 1) {
      runningStreak++;
      if (runningStreak > longestStreak) {
        longestStreak = runningStreak;
      }
    } else {
      runningStreak = 1;
    }
  }

  return {
    currentStreak,
    longestStreak: Math.max(longestStreak, currentStreak),
    lastWorkoutDate: lastWorkoutDate ?? null,
  };
}

// ---------------------------------------------------------------------------
// buildFrequencyMap
// ---------------------------------------------------------------------------

export function buildFrequencyMap(
  workouts: Array<{
    date: Date | string;
    totalVolume: number | null;
    durationMinutes: number | null;
  }>,
): WorkoutFrequencyDay[] {
  const map = new Map<
    string,
    {
      workoutCount: number;
      totalVolume: number | null;
      totalDurationMinutes: number | null;
    }
  >();

  for (const w of workouts) {
    const dateStr = toDateString(w.date);

    const existing = map.get(dateStr) ?? {
      workoutCount: 0,
      totalVolume: null,
      totalDurationMinutes: null,
    };

    existing.workoutCount += 1;

    if (w.totalVolume != null) {
      existing.totalVolume = (existing.totalVolume ?? 0) + w.totalVolume;
    }

    if (w.durationMinutes != null) {
      existing.totalDurationMinutes =
        (existing.totalDurationMinutes ?? 0) + w.durationMinutes;
    }

    map.set(dateStr, existing);
  }

  return Array.from(map.entries())
    .map(([date, data]) => ({
      date,
      workoutCount: data.workoutCount,
      totalVolume: data.totalVolume,
      totalDurationMinutes: data.totalDurationMinutes,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// groupPersonalRecordsByExercise
// ---------------------------------------------------------------------------

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
}> {
  const map = new Map<
    string,
    {
      exerciseName: string;
      records: Array<{
        recordType: string;
        value: number;
        delta: number | null;
        dateAchieved: Date;
      }>;
    }
  >();

  for (const r of records) {
    if (r.exerciseId == null) continue;

    const existing = map.get(r.exerciseId) ?? {
      exerciseName: r.exerciseName ?? r.exerciseId,
      records: [],
    };

    existing.records.push({
      recordType: r.recordType,
      value: r.value,
      delta:
        r.previousRecordValue != null ? r.value - r.previousRecordValue : null,
      dateAchieved: r.dateAchieved,
    });

    map.set(r.exerciseId, existing);
  }

  return Array.from(map.entries()).map(([exerciseId, data]) => ({
    exerciseId,
    exerciseName: data.exerciseName,
    records: data.records.sort(
      (a, b) => b.dateAchieved.getTime() - a.dateAchieved.getTime(),
    ),
  }));
}
