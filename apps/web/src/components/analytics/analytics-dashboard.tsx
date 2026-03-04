import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { trpc } from "@/utils/trpc";
import { Separator } from "@/components/ui/separator";
import { VolumeOverTimeChart } from "./volume-over-time-chart";
import { MuscleGroupChart } from "./muscle-group-chart";
import { PersonalRecordsGrid } from "./personal-records-grid";
import { WorkoutHeatmap } from "./workout-heatmap";
import { OverloadStatusList } from "./overload-status-list";

export function AnalyticsDashboard() {
  const [granularity, setGranularity] = useState<"weekly" | "monthly">(
    "weekly",
  );
  const [categorizationSystem, setCategorizationSystem] = useState<
    "bodybuilding" | "movement_patterns"
  >("bodybuilding");

  // tRPC queries
  const volumeData = useQuery(
    trpc.analytics.volumeOverTime.queryOptions({ granularity }),
  );

  const muscleGroupData = useQuery(
    trpc.analytics.muscleGroupVolume.queryOptions({
      categorizationSystem,
    }),
  );

  const prData = useQuery(trpc.analytics.personalRecords.queryOptions());

  const frequencyData = useQuery(
    trpc.analytics.workoutFrequency.queryOptions(),
  );

  const overloadData = useQuery(
    trpc.analytics.progressiveOverload.queryOptions(),
  );

  return (
    <div className="container mx-auto max-w-5xl space-y-10 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Track your progress and training trends over time.
        </p>
      </div>

      {/* Volume Over Time */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">Volume Over Time</h2>
        <VolumeOverTimeChart
          data={volumeData.data ?? []}
          granularity={granularity}
          onGranularityChange={setGranularity}
          isLoading={volumeData.isLoading}
        />
      </section>

      <Separator />

      {/* Muscle Group Volume */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">
          Volume by Muscle Group
        </h2>
        <MuscleGroupChart
          data={
            (muscleGroupData.data ?? []).map((row) => ({
              weekStartDate: String(row.weekStartDate),
              muscleGroup: row.muscleGroup ?? "",
              totalVolume: row.totalVolume ?? 0,
            }))
          }
          categorizationSystem={categorizationSystem}
          onSystemChange={setCategorizationSystem}
          isLoading={muscleGroupData.isLoading}
        />
      </section>

      <Separator />

      {/* Personal Records */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">Personal Records</h2>
        <PersonalRecordsGrid
          data={prData.data ?? []}
          isLoading={prData.isLoading}
        />
      </section>

      <Separator />

      {/* Workout Heatmap */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">Workout Frequency</h2>
        <WorkoutHeatmap
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
      </section>

      <Separator />

      {/* Progressive Overload Status */}
      <section>
        <h2 className="mb-4 text-lg font-semibold">
          Progressive Overload Status
        </h2>
        <OverloadStatusList
          data={overloadData.data ?? []}
          isLoading={overloadData.isLoading}
        />
      </section>
    </div>
  );
}
