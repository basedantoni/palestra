import { useMemo, useState } from "react";
import { Dimensions, ScrollView, Text, TouchableOpacity, View } from "react-native";

import type { WorkoutFrequencyDay, StreakResult } from "@src/api/lib/analytics-queries";

interface NativeWorkoutHeatmapProps {
  days: WorkoutFrequencyDay[];
  streaks: StreakResult;
  isLoading: boolean;
}

const HEATMAP_COLORS = [
  "#1f2937", // level 0: no workout (dark gray)
  "#065f46", // level 1
  "#059669", // level 2
  "#10b981", // level 3
  "#34d399", // level 4 (max)
];

const CELL_SIZE = 11;
const CELL_GAP = 2;
const CELL_STEP = CELL_SIZE + CELL_GAP;

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
  weeks: Array<
    Array<{ date: string; day: WorkoutFrequencyDay | null; future: boolean }>
  >;
  monthLabels: Array<{ label: string; colIndex: number }>;
} {
  const dayMap = new Map<string, WorkoutFrequencyDay>();
  for (const d of days) {
    dayMap.set(d.date, d);
  }

  const today = new Date();
  today.setHours(12, 0, 0, 0);

  const start = new Date(today);
  start.setDate(start.getDate() - 52 * 7);
  // Align to Sunday
  start.setDate(start.getDate() - start.getDay());

  const weeks: Array<
    Array<{ date: string; day: WorkoutFrequencyDay | null; future: boolean }>
  > = [];
  const monthLabels: Array<{ label: string; colIndex: number }> = [];
  let lastMonth = -1;

  const cursor = new Date(start);
  for (let col = 0; col < 53; col++) {
    const week: Array<{
      date: string;
      day: WorkoutFrequencyDay | null;
      future: boolean;
    }> = [];
    for (let row = 0; row < 7; row++) {
      const dateStr = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
      const isFuture = cursor > today;
      week.push({
        date: dateStr,
        day: isFuture ? null : (dayMap.get(dateStr) ?? null),
        future: isFuture,
      });

      if (row === 0 && cursor.getMonth() !== lastMonth && !isFuture) {
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

export function NativeWorkoutHeatmap({
  days,
  streaks,
  isLoading,
}: NativeWorkoutHeatmapProps) {
  const [tooltip, setTooltip] = useState<{
    date: string;
    day: WorkoutFrequencyDay;
  } | null>(null);

  const maxVolume = useMemo(
    () => Math.max(...days.map((d) => d.totalVolume ?? 0), 0),
    [days],
  );

  const { weeks, monthLabels } = useMemo(() => buildCalendarGrid(days), [days]);

  if (isLoading) {
    return <View className="h-40 bg-muted rounded-md animate-pulse" />;
  }

  const gridWidth = weeks.length * CELL_STEP;

  return (
    <View className="gap-4">
      {/* Streak counters */}
      <View className="flex-row gap-6">
        <View>
          <Text className="text-base font-semibold text-foreground">
            {streaks.currentStreak}
          </Text>
          <Text className="text-xs text-muted">day current streak</Text>
        </View>
        <View>
          <Text className="text-base font-semibold text-foreground">
            {streaks.longestStreak}
          </Text>
          <Text className="text-xs text-muted">day longest streak</Text>
        </View>
      </View>

      {/* Tooltip overlay */}
      {tooltip && (
        <View className="bg-popover border border-border rounded-md px-3 py-2">
          <Text className="text-xs font-medium text-foreground">
            {new Date(tooltip.date + "T12:00:00").toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </Text>
          <Text className="text-xs text-muted">
            {tooltip.day.workoutCount}{" "}
            {tooltip.day.workoutCount === 1 ? "workout" : "workouts"}
          </Text>
          {tooltip.day.totalVolume != null && (
            <Text className="text-xs text-muted">
              {tooltip.day.totalVolume.toLocaleString()} lbs
            </Text>
          )}
        </View>
      )}

      {/* Calendar heatmap */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ width: gridWidth + 28 }}>
          {/* Month labels */}
          <View style={{ height: 16, position: "relative", marginLeft: 26 }}>
            {monthLabels.map(({ label, colIndex }, i) => (
              <Text
                key={i}
                style={{
                  position: "absolute",
                  left: colIndex * CELL_STEP,
                  fontSize: 9,
                  color: "#6b7280",
                }}
              >
                {label}
              </Text>
            ))}
          </View>

          {/* Grid with day labels */}
          <View style={{ flexDirection: "row" }}>
            {/* Day-of-week labels */}
            <View style={{ width: 24, gap: CELL_GAP }}>
              {["", "M", "", "W", "", "F", ""].map((label, i) => (
                <View key={i} style={{ height: CELL_SIZE, justifyContent: "center" }}>
                  <Text style={{ fontSize: 8, color: "#6b7280" }}>{label}</Text>
                </View>
              ))}
            </View>

            {/* Weeks */}
            <View style={{ flexDirection: "row", gap: CELL_GAP }}>
              {weeks.map((week, colIdx) => (
                <View key={colIdx} style={{ flexDirection: "column", gap: CELL_GAP }}>
                  {week.map(({ date, day, future }, rowIdx) => {
                    if (future) {
                      return (
                        <View
                          key={rowIdx}
                          style={{
                            width: CELL_SIZE,
                            height: CELL_SIZE,
                            backgroundColor: "transparent",
                          }}
                        />
                      );
                    }
                    const level = day
                      ? getIntensityLevel(day.totalVolume, maxVolume)
                      : 0;
                    const bgColor =
                      day && day.workoutCount > 0
                        ? HEATMAP_COLORS[level] ?? HEATMAP_COLORS[0]
                        : HEATMAP_COLORS[0];
                    return (
                      <TouchableOpacity
                        key={rowIdx}
                        activeOpacity={day ? 0.7 : 1}
                        onPress={() => {
                          if (day && day.workoutCount > 0) {
                            setTooltip(
                              tooltip?.date === date ? null : { date, day },
                            );
                          } else {
                            setTooltip(null);
                          }
                        }}
                        style={{
                          width: CELL_SIZE,
                          height: CELL_SIZE,
                          backgroundColor: bgColor,
                          borderRadius: 2,
                        }}
                      />
                    );
                  })}
                </View>
              ))}
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Legend */}
      <View className="flex-row items-center gap-1">
        <Text style={{ fontSize: 10, color: "#6b7280" }}>Less</Text>
        {HEATMAP_COLORS.map((color, i) => (
          <View
            key={i}
            style={{
              width: CELL_SIZE,
              height: CELL_SIZE,
              backgroundColor: color,
              borderRadius: 2,
            }}
          />
        ))}
        <Text style={{ fontSize: 10, color: "#6b7280" }}>More</Text>
      </View>
    </View>
  );
}
