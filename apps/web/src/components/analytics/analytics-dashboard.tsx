import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { trpc } from "@/utils/trpc";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { VolumeOverTimeChart } from "./volume-over-time-chart";
import { MuscleGroupChart } from "./muscle-group-chart";
import { PersonalRecordsGrid } from "./personal-records-grid";
import { WorkoutHeatmap } from "./workout-heatmap";
import { OverloadStatusList } from "./overload-status-list";
import { RunningVolumeChart } from "./running-volume-chart";
import { RunningPaceTrendChart } from "./running-pace-trend-chart";
import { WorkoutTypeMixChart } from "./workout-type-mix-chart";
import { MobilityFrequencyChart } from "./mobility-frequency-chart";
import { WhoopHrTrendChart } from "./whoop-hr-trend-chart";
import { WhoopPaceTrendChart } from "./whoop-pace-trend-chart";
import { WhoopWeeklyDistanceChart } from "./whoop-weekly-distance-chart";

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

export function AnalyticsDashboard() {
  const [granularity, setGranularity] = useState<"weekly" | "monthly">(
    "weekly",
  );
  const [categorizationSystem, setCategorizationSystem] = useState<
    "bodybuilding" | "movement_patterns"
  >("bodybuilding");
  const [selectedRunningExerciseId, setSelectedRunningExerciseId] = useState<
    string | undefined
  >(undefined);

  const preferences = useQuery(trpc.preferences.get.queryOptions());
  const distanceUnit = preferences.data?.distanceUnit ?? "mi";

  const whoopDateRange = useLast30DaysRange();

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

  const runningVolumeData = useQuery(
    trpc.analytics.weeklyRunningVolume.queryOptions(),
  );
  const runningPaceTrend = useQuery(
    trpc.analytics.runningPaceTrend.queryOptions(),
  );
  const mobilityFrequency = useQuery(
    trpc.analytics.mobilityFrequency.queryOptions(),
  );
  const workoutTypeMix = useQuery(
    trpc.analytics.workoutTypeMix.queryOptions(),
  );

  const whoopHrTrend = useQuery(
    trpc.analytics.runningHrTrend.queryOptions(whoopDateRange),
  );
  const whoopPaceTrend = useQuery(
    trpc.analytics.whoopPaceTrend.queryOptions(whoopDateRange),
  );
  const whoopWeeklyDistance = useQuery(
    trpc.analytics.weeklyRunDistance.queryOptions(whoopDateRange),
  );

  const runningExerciseOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const point of runningPaceTrend.data ?? []) {
      byId.set(point.exerciseId, point.exerciseName);
    }
    return Array.from(byId.entries()).map(([id, name]) => ({ id, name }));
  }, [runningPaceTrend.data]);

  useEffect(() => {
    if (runningExerciseOptions.length === 0) {
      setSelectedRunningExerciseId(undefined);
      return;
    }

    if (
      !selectedRunningExerciseId ||
      !runningExerciseOptions.some(
        (option) => option.id === selectedRunningExerciseId,
      )
    ) {
      setSelectedRunningExerciseId(runningExerciseOptions[0]!.id);
    }
  }, [runningExerciseOptions, selectedRunningExerciseId]);

  const selectedRunningPaceData = useMemo(() => {
    if (!selectedRunningExerciseId) return [];
    return (runningPaceTrend.data ?? []).filter(
      (point) => point.exerciseId === selectedRunningExerciseId,
    );
  }, [runningPaceTrend.data, selectedRunningExerciseId]);

  const runningPrData = useMemo(() => {
    return (prData.data ?? [])
      .map((exercise) => ({
        ...exercise,
        records: exercise.records.filter(
          (record) =>
            record.recordType === "best_pace" ||
            record.recordType === "longest_distance",
        ),
      }))
      .filter((exercise) => exercise.records.length > 0);
  }, [prData.data]);

  return (
    <div className="container mx-auto max-w-5xl space-y-8 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold">Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Track your progress across lifting, running, and mobility.
        </p>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="running">Running</TabsTrigger>
          <TabsTrigger value="whoop-running">Whoop Runs</TabsTrigger>
          <TabsTrigger value="mobility">Mobility</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-10">
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

          <section>
            <h2 className="mb-4 text-lg font-semibold">Volume by Muscle Group</h2>
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

          <section>
            <h2 className="mb-4 text-lg font-semibold">Personal Records</h2>
            <PersonalRecordsGrid
              data={prData.data ?? []}
              isLoading={prData.isLoading}
              distanceUnit={distanceUnit}
            />
          </section>

          <Separator />

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

          <section>
            <h2 className="mb-4 text-lg font-semibold">Workout Type Mix</h2>
            <WorkoutTypeMixChart
              data={workoutTypeMix.data ?? []}
              isLoading={workoutTypeMix.isLoading}
            />
          </section>

          <Separator />

          <section>
            <h2 className="mb-4 text-lg font-semibold">
              Progressive Overload Status
            </h2>
            <OverloadStatusList
              data={overloadData.data ?? []}
              isLoading={overloadData.isLoading}
            />
          </section>
        </TabsContent>

        <TabsContent value="running" className="space-y-10">
          <section>
            <h2 className="mb-4 text-lg font-semibold">Weekly Running Distance</h2>
            <RunningVolumeChart
              data={runningVolumeData.data ?? []}
              distanceUnit={distanceUnit}
              isLoading={runningVolumeData.isLoading}
            />
          </section>

          <Separator />

          <section>
            <h2 className="mb-4 text-lg font-semibold">Pace Trend</h2>
            <RunningPaceTrendChart
              data={selectedRunningPaceData}
              distanceUnit={distanceUnit}
              exerciseOptions={runningExerciseOptions}
              selectedExerciseId={selectedRunningExerciseId}
              onExerciseChange={(exerciseId) =>
                setSelectedRunningExerciseId(exerciseId ?? undefined)
              }
              isLoading={runningPaceTrend.isLoading}
            />
          </section>

          <Separator />

          <section>
            <h2 className="mb-4 text-lg font-semibold">Running Personal Records</h2>
            <PersonalRecordsGrid
              data={runningPrData}
              isLoading={prData.isLoading}
              distanceUnit={distanceUnit}
            />
          </section>
        </TabsContent>

        <TabsContent value="whoop-running" className="space-y-10">
          <section>
            <h2 className="mb-4 text-lg font-semibold">Avg HR Trend</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Average heart rate per Whoop-linked run over the last 30 days.
            </p>
            <WhoopHrTrendChart
              data={whoopHrTrend.data ?? []}
              isLoading={whoopHrTrend.isLoading}
            />
          </section>

          <Separator />

          <section>
            <h2 className="mb-4 text-lg font-semibold">Pace Trend</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Pace per Whoop-linked run. Lower is faster.
            </p>
            <WhoopPaceTrendChart
              data={whoopPaceTrend.data ?? []}
              isLoading={whoopPaceTrend.isLoading}
            />
          </section>

          <Separator />

          <section>
            <h2 className="mb-4 text-lg font-semibold">Weekly Distance</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Total distance from Whoop-linked runs per calendar week.
            </p>
            <WhoopWeeklyDistanceChart
              data={whoopWeeklyDistance.data ?? []}
              distanceUnit={distanceUnit}
              isLoading={whoopWeeklyDistance.isLoading}
            />
          </section>
        </TabsContent>

        <TabsContent value="mobility" className="space-y-10">
          <section>
            <h2 className="mb-4 text-lg font-semibold">Mobility Frequency</h2>
            <MobilityFrequencyChart
              data={mobilityFrequency.data ?? []}
              isLoading={mobilityFrequency.isLoading}
            />
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
