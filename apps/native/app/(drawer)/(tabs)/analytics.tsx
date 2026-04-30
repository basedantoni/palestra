import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { trpc } from "@/utils/trpc";
import { NativeVolumeChart } from "@/components/analytics/NativeVolumeChart";
import { NativeMuscleGroupChart } from "@/components/analytics/NativeMuscleGroupChart";
import { NativePersonalRecords } from "@/components/analytics/NativePersonalRecords";
import { NativeWorkoutHeatmap } from "@/components/analytics/NativeWorkoutHeatmap";
import { NativeOverloadStatus } from "@/components/analytics/NativeOverloadStatus";
import { NativeWhoopHrTrend } from "@/components/analytics/NativeWhoopHrTrend";
import { NativeWhoopPaceTrend } from "@/components/analytics/NativeWhoopPaceTrend";
import { NativeWhoopWeeklyDistance } from "@/components/analytics/NativeWhoopWeeklyDistance";

function useLast30DaysRange(): { from: string; to: string } {
  return useMemo(() => {
    const now = new Date();
    const to = now.toISOString().slice(0, 10);
    const from30 = new Date(now);
    from30.setDate(from30.getDate() - 30);
    const from = from30.toISOString().slice(0, 10);
    return { from, to };
  }, []);
}

export default function AnalyticsTab() {
  const insets = useSafeAreaInsets();
  const [granularity, setGranularity] = useState<"weekly" | "monthly">("weekly");
  const [categorizationSystem, setCategorizationSystem] = useState<
    "bodybuilding" | "movement_patterns"
  >("bodybuilding");

  const volumeData = useQuery(
    trpc.analytics.volumeOverTime.queryOptions({ granularity }),
  );

  const muscleGroupData = useQuery(
    trpc.analytics.muscleGroupVolume.queryOptions({ categorizationSystem }),
  );

  const prData = useQuery(trpc.analytics.personalRecords.queryOptions());
  const preferencesData = useQuery(trpc.preferences.get.queryOptions());
  const distanceUnit = preferencesData.data?.distanceUnit ?? "mi";

  const frequencyData = useQuery(
    trpc.analytics.workoutFrequency.queryOptions(),
  );

  const overloadData = useQuery(
    trpc.analytics.progressiveOverload.queryOptions(),
  );

  const whoopDateRange = useLast30DaysRange();

  const whoopHrTrend = useQuery(
    trpc.analytics.runningHrTrend.queryOptions(whoopDateRange),
  );
  const whoopPaceTrend = useQuery(
    trpc.analytics.whoopPaceTrend.queryOptions(whoopDateRange),
  );
  const whoopWeeklyDistance = useQuery(
    trpc.analytics.weeklyRunDistance.queryOptions(whoopDateRange),
  );

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
    >
      {/* Header */}
      <View className="px-6 pt-6 pb-4">
        <Text className="text-2xl font-bold text-foreground">Analytics</Text>
        <Text className="text-sm text-muted mt-1">
          Track your progress and training trends.
        </Text>
      </View>

      {/* Volume Over Time */}
      <View className="px-6 mb-8">
        <Text className="text-lg font-semibold text-foreground mb-4">
          Volume Over Time
        </Text>
        <NativeVolumeChart
          data={volumeData.data ?? []}
          granularity={granularity}
          onGranularityChange={setGranularity}
          isLoading={volumeData.isLoading}
        />
      </View>

      {/* Divider */}
      <View className="border-t border-border mx-6 mb-8" />

      {/* Muscle Group Volume */}
      <View className="px-6 mb-8">
        <Text className="text-lg font-semibold text-foreground mb-4">
          Volume by Muscle Group
        </Text>
        <NativeMuscleGroupChart
          data={(muscleGroupData.data ?? []).map((row) => ({
            weekStartDate: String(row.weekStartDate),
            muscleGroup: row.muscleGroup ?? "",
            totalVolume: row.totalVolume ?? 0,
          }))}
          categorizationSystem={categorizationSystem}
          onSystemChange={setCategorizationSystem}
          isLoading={muscleGroupData.isLoading}
        />
      </View>

      {/* Divider */}
      <View className="border-t border-border mx-6 mb-8" />

      {/* Personal Records */}
      <View className="px-6 mb-8">
        <Text className="text-lg font-semibold text-foreground mb-4">
          Personal Records
        </Text>
        <NativePersonalRecords
          data={prData.data ?? []}
          isLoading={prData.isLoading}
          distanceUnit={preferencesData.data?.distanceUnit ?? "mi"}
        />
      </View>

      {/* Divider */}
      <View className="border-t border-border mx-6 mb-8" />

      {/* Workout Frequency Heatmap */}
      <View className="px-6 mb-8">
        <Text className="text-lg font-semibold text-foreground mb-4">
          Workout Frequency
        </Text>
        <NativeWorkoutHeatmap
          days={frequencyData.data?.days ?? []}
          streaks={
            frequencyData.data?.streaks ?? {
              currentStreak: 0,
              longestStreak: 0,
              lastWorkoutDate: null,
            }
          }
          isLoading={frequencyData.isLoading}
        />
      </View>

      {/* Divider */}
      <View className="border-t border-border mx-6 mb-8" />

      {/* Progressive Overload Status */}
      <View className="px-6 mb-8">
        <Text className="text-lg font-semibold text-foreground mb-4">
          Progressive Overload Status
        </Text>
        <NativeOverloadStatus
          data={overloadData.data ?? []}
          isLoading={overloadData.isLoading}
        />
      </View>

      {/* Divider */}
      <View className="border-t border-border mx-6 mb-8" />

      {/* Whoop Running — Avg HR Trend */}
      <View className="px-6 mb-8">
        <Text className="text-lg font-semibold text-foreground mb-1">
          Whoop Runs — Avg HR
        </Text>
        <Text className="text-sm text-muted mb-4">
          Average heart rate per Whoop-linked run (last 30 days).
        </Text>
        <NativeWhoopHrTrend
          data={whoopHrTrend.data ?? []}
          isLoading={whoopHrTrend.isLoading}
        />
      </View>

      {/* Divider */}
      <View className="border-t border-border mx-6 mb-8" />

      {/* Whoop Running — Pace Trend */}
      <View className="px-6 mb-8">
        <Text className="text-lg font-semibold text-foreground mb-1">
          Whoop Runs — Pace
        </Text>
        <Text className="text-sm text-muted mb-4">
          Pace per Whoop-linked run. Lower is faster.
        </Text>
        <NativeWhoopPaceTrend
          data={whoopPaceTrend.data ?? []}
          isLoading={whoopPaceTrend.isLoading}
        />
      </View>

      {/* Divider */}
      <View className="border-t border-border mx-6 mb-8" />

      {/* Whoop Running — Weekly Distance */}
      <View className="px-6 mb-8">
        <Text className="text-lg font-semibold text-foreground mb-1">
          Whoop Runs — Weekly Distance
        </Text>
        <Text className="text-sm text-muted mb-4">
          Total distance from Whoop-linked runs per calendar week.
        </Text>
        <NativeWhoopWeeklyDistance
          data={whoopWeeklyDistance.data ?? []}
          distanceUnit={distanceUnit}
          isLoading={whoopWeeklyDistance.isLoading}
        />
      </View>
    </ScrollView>
  );
}
