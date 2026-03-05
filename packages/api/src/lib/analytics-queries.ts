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

// ---------------------------------------------------------------------------
// aggregateVolumeByWeek
// ---------------------------------------------------------------------------

export function aggregateVolumeByWeek(
  workouts: Array<{ date: Date | string; totalVolume: number | null }>,
): VolumeDataPoint[] {
  const map = new Map<string, { totalVolume: number; workoutCount: number }>();

  for (const w of workouts) {
    const d = toLocalNoon(w.date);
    const weekNum = getISOWeek(d);
    const weekYear = getISOWeekYear(d);
    const period = `${weekYear}-W${String(weekNum).padStart(2, "0")}`;

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
