import { useMemo, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type {
  WorkoutFrequencyDay,
  StreakResult,
} from "@src/api/lib/analytics-queries";

interface WorkoutHeatmapProps {
  days: WorkoutFrequencyDay[];
  streaks: StreakResult;
  isLoading: boolean;
}

const HEATMAP_COLORS = [
  "bg-muted",
  "bg-emerald-200 dark:bg-emerald-900",
  "bg-emerald-400 dark:bg-emerald-700",
  "bg-emerald-500 dark:bg-emerald-500",
  "bg-emerald-700 dark:bg-emerald-300",
];

const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

function getIntensityLevel(volume: number | null, maxVolume: number): number {
  if (volume == null || volume === 0) return 0;
  if (maxVolume === 0) return 1;
  const ratio = volume / maxVolume;
  if (ratio < 0.25) return 1;
  if (ratio < 0.5) return 2;
  if (ratio < 0.75) return 3;
  return 4;
}

function buildCalendarGrid(days: WorkoutFrequencyDay[]): {
  weeks: Array<Array<{ date: string; day: WorkoutFrequencyDay | null }>>;
  monthLabels: Array<{ label: string; colIndex: number }>;
} {
  const dayMap = new Map<string, WorkoutFrequencyDay>();
  for (const d of days) {
    dayMap.set(d.date, d);
  }

  const today = new Date();
  today.setHours(12, 0, 0, 0);

  // Start from 52 weeks ago, aligned to Sunday
  const start = new Date(today);
  start.setDate(start.getDate() - 52 * 7);
  // Align to Sunday (day 0)
  start.setDate(start.getDate() - start.getDay());

  const weeks: Array<Array<{ date: string; day: WorkoutFrequencyDay | null }>> =
    [];
  const monthLabels: Array<{ label: string; colIndex: number }> = [];
  let lastMonth = -1;

  const cursor = new Date(start);
  for (let col = 0; col < 53; col++) {
    const week: Array<{ date: string; day: WorkoutFrequencyDay | null }> = [];
    for (let row = 0; row < 7; row++) {
      const dateStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
      // Only show cells up to today
      if (cursor <= today) {
        week.push({ date: dateStr, day: dayMap.get(dateStr) ?? null });
      } else {
        week.push({ date: dateStr, day: null });
      }

      if (row === 0 && cursor.getMonth() !== lastMonth && cursor <= today) {
        lastMonth = cursor.getMonth();
        monthLabels.push({
          label: cursor.toLocaleString("en-US", { month: "short" }),
          colIndex: col,
        });
      }

      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }

  return { weeks, monthLabels };
}

export function WorkoutHeatmap({
  days,
  streaks,
  isLoading,
}: WorkoutHeatmapProps) {
  const [tooltip, setTooltip] = useState<{
    date: string;
    day: WorkoutFrequencyDay;
    x: number;
    y: number;
  } | null>(null);

  const maxVolume = useMemo(() => {
    return Math.max(...days.map((d) => d.totalVolume ?? 0), 0);
  }, [days]);

  const { weeks, monthLabels } = useMemo(() => buildCalendarGrid(days), [days]);

  if (isLoading) {
    return <Skeleton className="h-40 w-full" />;
  }

  return (
    <div className="space-y-4">
      {/* Streak counters */}
      <div className="flex gap-6 text-sm">
        <div>
          <span className="font-semibold text-foreground">
            {streaks.currentStreak}
          </span>
          <span className="ml-1 text-muted-foreground">day current streak</span>
        </div>
        <div>
          <span className="font-semibold text-foreground">
            {streaks.longestStreak}
          </span>
          <span className="ml-1 text-muted-foreground">day longest streak</span>
        </div>
        {streaks.lastWorkoutDate && (
          <div className="text-muted-foreground">
            Last workout:{" "}
            {new Date(streaks.lastWorkoutDate + "T12:00:00").toLocaleDateString(
              "en-US",
              { month: "short", day: "numeric" },
            )}
          </div>
        )}
      </div>

      {/* Calendar grid */}
      <div className="overflow-x-auto">
        <div className="relative inline-block">
          {/* Month labels row */}
          <div className="mb-1 flex" style={{ paddingLeft: 24 }}>
            {monthLabels.map(({ label, colIndex }, i) => (
              <div
                key={i}
                className="absolute text-xs text-muted-foreground"
                style={{ left: 24 + colIndex * 14 }}
              >
                {label}
              </div>
            ))}
          </div>
          <div className="mt-5 flex gap-0.5">
            {/* Day-of-week labels */}
            <div className="mr-1 flex flex-col gap-0.5">
              {DAY_LABELS.map((label, i) => (
                <div
                  key={i}
                  className="flex h-3 w-5 items-center text-[9px] text-muted-foreground"
                >
                  {label}
                </div>
              ))}
            </div>

            {/* Weeks */}
            {weeks.map((week, colIdx) => (
              <div key={colIdx} className="flex flex-col gap-0.5">
                {week.map(({ date, day }, rowIdx) => {
                  const level = day
                    ? getIntensityLevel(day.totalVolume, maxVolume)
                    : 0;
                  const isEmpty = day == null;
                  return (
                    <div
                      key={rowIdx}
                      className={cn(
                        "h-3 w-3 cursor-default rounded-sm",
                        isEmpty
                          ? "bg-slate-100 dark:bg-slate-800"
                          : HEATMAP_COLORS[level],
                      )}
                      onMouseEnter={(e) => {
                        if (day) {
                          const rect = (
                            e.target as HTMLElement
                          ).getBoundingClientRect();
                          setTooltip({ date, day, x: rect.left, y: rect.top });
                        }
                      }}
                      onMouseLeave={() => setTooltip(null)}
                    />
                  );
                })}
              </div>
            ))}
          </div>

          {/* Tooltip */}
          {tooltip && (
            <div
              className="pointer-events-none fixed z-50 rounded-md border bg-popover px-2 py-1.5 text-xs shadow-md"
              style={{ left: tooltip.x + 16, top: tooltip.y - 8 }}
            >
              <div className="font-medium">
                {new Date(tooltip.date + "T12:00:00").toLocaleDateString(
                  "en-US",
                  {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  },
                )}
              </div>
              <div className="text-muted-foreground">
                {tooltip.day.workoutCount}{" "}
                {tooltip.day.workoutCount === 1 ? "workout" : "workouts"}
              </div>
              {tooltip.day.totalVolume != null && (
                <div className="text-muted-foreground">
                  {tooltip.day.totalVolume.toLocaleString()} lbs
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <span>Less</span>
        {HEATMAP_COLORS.map((cls, i) => (
          <div key={i} className={cn("h-3 w-3 rounded-sm", cls)} />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}
