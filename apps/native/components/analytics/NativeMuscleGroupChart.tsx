import { Pressable, Text, View } from "react-native";
import { CartesianChart, StackedBar } from "victory-native";
import type { PointsArray } from "victory-native";

interface MuscleGroupDataRow {
  weekStartDate: string;
  muscleGroup: string;
  totalVolume: number;
}

interface NativeMuscleGroupChartProps {
  data: MuscleGroupDataRow[];
  categorizationSystem: "bodybuilding" | "movement_patterns";
  onSystemChange: (s: "bodybuilding" | "movement_patterns") => void;
  isLoading: boolean;
}

const MUSCLE_GROUP_COLORS: Record<string, string> = {
  chest: "#ef4444",
  back: "#3b82f6",
  shoulders: "#f59e0b",
  arms: "#8b5cf6",
  legs: "#10b981",
  core: "#ec4899",
};

const MOVEMENT_COLORS: Record<string, string> = {
  push: "#ef4444",
  pull: "#3b82f6",
  squat: "#10b981",
  hinge: "#f59e0b",
  carry: "#8b5cf6",
};

function formatWeekLabel(dateStr: string): string {
  const parts = dateStr.split("-");
  if (parts.length < 3) return dateStr;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const d = new Date(year, month - 1, day, 12);
  return d.toLocaleString("en-US", { month: "short", day: "numeric" });
}

export function NativeMuscleGroupChart({
  data,
  categorizationSystem,
  onSystemChange,
  isLoading,
}: NativeMuscleGroupChartProps) {
  if (isLoading) {
    return <View className="h-52 bg-muted rounded-md animate-pulse" />;
  }

  const colors =
    categorizationSystem === "bodybuilding" ? MUSCLE_GROUP_COLORS : MOVEMENT_COLORS;

  const muscleGroups = Array.from(new Set(data.map((r) => r.muscleGroup))).sort();

  // Pivot: group by week
  const weekMap = new Map<string, Record<string, number>>();
  for (const row of data) {
    const existing = weekMap.get(row.weekStartDate) ?? {};
    existing[row.muscleGroup] = (existing[row.muscleGroup] ?? 0) + row.totalVolume;
    weekMap.set(row.weekStartDate, existing);
  }

  const chartData = Array.from(weekMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStartDate, volumes]) => ({
      week: formatWeekLabel(weekStartDate),
      ...volumes,
    }));

  return (
    <View className="space-y-3">
      {/* Toggle buttons */}
      <View className="flex-row gap-2 flex-wrap">
        <Pressable
          onPress={() => onSystemChange("bodybuilding")}
          className={`px-3 py-1.5 rounded-md border ${
            categorizationSystem === "bodybuilding"
              ? "bg-primary border-primary"
              : "bg-transparent border-border"
          }`}
        >
          <Text
            className={
              categorizationSystem === "bodybuilding"
                ? "text-xs font-medium text-primary-foreground"
                : "text-xs font-medium text-foreground"
            }
          >
            Bodybuilding
          </Text>
        </Pressable>
        <Pressable
          onPress={() => onSystemChange("movement_patterns")}
          className={`px-3 py-1.5 rounded-md border ${
            categorizationSystem === "movement_patterns"
              ? "bg-primary border-primary"
              : "bg-transparent border-border"
          }`}
        >
          <Text
            className={
              categorizationSystem === "movement_patterns"
                ? "text-xs font-medium text-primary-foreground"
                : "text-xs font-medium text-foreground"
            }
          >
            Movement Patterns
          </Text>
        </Pressable>
      </View>

      {chartData.length === 0 || muscleGroups.length === 0 ? (
        <View className="h-48 items-center justify-center border border-dashed border-border rounded-md">
          <Text className="text-sm text-muted">No muscle group data yet.</Text>
        </View>
      ) : (
        <>
          <View style={{ height: 200 }}>
            {/*
             * Victory Native's CartesianChart generics require yKeys to be
             * a union of literal string types derived from the data shape.
             * Since our muscle groups are dynamic strings, we cast the data
             * and yKeys through `unknown` to satisfy the constraint at runtime.
             */}
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <CartesianChart
              data={chartData as any[]}
              xKey={"week" as any}
              yKeys={muscleGroups as any}
              axisOptions={{
                font: null,
                tickCount: { x: Math.min(chartData.length, 5), y: 4 },
              }}
            >
              {({ points, chartBounds }: { points: Record<string, PointsArray>; chartBounds: any }) => (
                <StackedBar
                  points={Object.values(points) as PointsArray[]}
                  chartBounds={chartBounds}
                  colors={muscleGroups.map((mg) => colors[mg] ?? "#94a3b8")}
                  animate={{ type: "timing", duration: 300 }}
                />
              )}
            </CartesianChart>
          </View>

          {/* Manual legend */}
          <View className="flex-row flex-wrap gap-3">
            {muscleGroups.map((mg) => (
              <View key={mg} className="flex-row items-center gap-1">
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: colors[mg] ?? "#94a3b8",
                  }}
                />
                <Text className="text-xs text-muted">
                  {mg.charAt(0).toUpperCase() + mg.slice(1)}
                </Text>
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );
}
