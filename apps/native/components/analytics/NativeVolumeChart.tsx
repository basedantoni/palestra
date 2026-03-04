import { useState } from "react";
import { Dimensions, Pressable, Text, View } from "react-native";
import { CartesianChart, Line } from "victory-native";

import type { VolumeDataPoint } from "@src/api/lib/analytics-queries";

interface NativeVolumeChartProps {
  data: VolumeDataPoint[];
  granularity: "weekly" | "monthly";
  onGranularityChange: (g: "weekly" | "monthly") => void;
  isLoading: boolean;
}

function formatPeriodLabel(period: string): string {
  if (period.includes("-W")) {
    const week = period.split("-W")[1];
    return `W${Number(week)}`;
  }
  const parts = period.split("-");
  if (parts.length < 2) return period;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const date = new Date(year, month - 1, 1);
  return date.toLocaleString("en-US", { month: "short" });
}

const CHART_WIDTH = Dimensions.get("window").width - 48;

export function NativeVolumeChart({
  data,
  granularity,
  onGranularityChange,
  isLoading,
}: NativeVolumeChartProps) {
  if (isLoading) {
    return (
      <View className="h-52 bg-muted rounded-md animate-pulse" />
    );
  }

  const chartData = data.map((d) => ({
    period: formatPeriodLabel(d.period),
    totalVolume: d.totalVolume,
    workoutCount: d.workoutCount,
  }));

  return (
    <View className="space-y-3">
      {/* Toggle buttons */}
      <View className="flex-row gap-2">
        <Pressable
          onPress={() => onGranularityChange("weekly")}
          className={`px-3 py-1.5 rounded-md border ${
            granularity === "weekly"
              ? "bg-primary border-primary"
              : "bg-transparent border-border"
          }`}
        >
          <Text
            className={
              granularity === "weekly"
                ? "text-xs font-medium text-primary-foreground"
                : "text-xs font-medium text-foreground"
            }
          >
            Weekly
          </Text>
        </Pressable>
        <Pressable
          onPress={() => onGranularityChange("monthly")}
          className={`px-3 py-1.5 rounded-md border ${
            granularity === "monthly"
              ? "bg-primary border-primary"
              : "bg-transparent border-border"
          }`}
        >
          <Text
            className={
              granularity === "monthly"
                ? "text-xs font-medium text-primary-foreground"
                : "text-xs font-medium text-foreground"
            }
          >
            Monthly
          </Text>
        </Pressable>
      </View>

      {chartData.length === 0 ? (
        <View className="h-48 items-center justify-center border border-dashed border-border rounded-md">
          <Text className="text-sm text-muted">
            No volume data yet. Log some workouts to see your progress.
          </Text>
        </View>
      ) : (
        <View style={{ height: 200, width: CHART_WIDTH }}>
          <CartesianChart
            data={chartData}
            xKey="period"
            yKeys={["totalVolume"]}
            axisOptions={{
              font: null,
              tickCount: { x: Math.min(chartData.length, 6), y: 4 },
            }}
          >
            {({ points }) => (
              <Line
                points={points.totalVolume}
                color="#6366f1"
                strokeWidth={2}
                animate={{ type: "timing", duration: 300 }}
              />
            )}
          </CartesianChart>
        </View>
      )}
    </View>
  );
}
