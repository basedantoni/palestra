import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { trpc } from "@/utils/trpc";
import { NativeVolumeChart } from "@/components/analytics/NativeVolumeChart";
import { NativeMuscleGroupChart } from "@/components/analytics/NativeMuscleGroupChart";
import { NativePersonalRecords } from "@/components/analytics/NativePersonalRecords";
import { NativeWorkoutHeatmap } from "@/components/analytics/NativeWorkoutHeatmap";
import { NativeOverloadStatus } from "@/components/analytics/NativeOverloadStatus";

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

  const frequencyData = useQuery(
    trpc.analytics.workoutFrequency.queryOptions(),
  );

  const overloadData = useQuery(
    trpc.analytics.progressiveOverload.queryOptions(),
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
    </ScrollView>
  );
}
