export interface CalendarWorkoutSummary {
  id: string;
  date: Date | string;
  totalVolume?: number | null;
}

export interface CalendarDayMetadata {
  count: number;
  totalVolume: number;
}

export function getLocalDateKey(dateInput: Date | string): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function groupWorkoutsByLocalDay<T extends CalendarWorkoutSummary>(
  workouts: T[],
): Record<string, T[]> {
  const grouped: Record<string, T[]> = {};
  for (const workout of workouts) {
    const key = getLocalDateKey(workout.date);
    grouped[key] ??= [];
    grouped[key].push(workout);
  }
  return grouped;
}

export function buildCalendarDayMetadata<T extends CalendarWorkoutSummary>(
  grouped: Record<string, T[]>,
): Record<string, CalendarDayMetadata> {
  const metadata: Record<string, CalendarDayMetadata> = {};
  for (const [key, workouts] of Object.entries(grouped)) {
    const totalVolume = workouts.reduce((sum, workout) => {
      return sum + (workout.totalVolume ?? 0);
    }, 0);
    metadata[key] = {
      count: workouts.length,
      totalVolume,
    };
  }
  return metadata;
}

export function getLocalMonthRange(anchorDate: Date): {
  startDate: Date;
  endDate: Date;
} {
  const startDate = new Date(
    Date.UTC(anchorDate.getFullYear(), anchorDate.getMonth(), 1, 0, 0, 0, 0),
  );
  const endDate = new Date(
    Date.UTC(
      anchorDate.getFullYear(),
      anchorDate.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    ),
  );

  return { startDate, endDate };
}
