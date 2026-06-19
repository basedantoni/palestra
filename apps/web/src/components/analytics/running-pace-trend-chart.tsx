import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { RunningPaceTrendPoint } from "@life-tracker/api/lib/analytics-queries";
import {
  formatDateLabel,
  formatPaceFromMinPerUnit,
} from "@life-tracker/api/lib/index";
import {
  WorkoutChooserDialog,
  type WorkoutChooserTarget,
} from "./workout-chooser-dialog";

interface RunningPaceTrendChartProps {
  data: RunningPaceTrendPoint[];
  distanceUnit: "mi" | "km";
  isLoading: boolean;
}

export function RunningPaceTrendChart({
  data,
  distanceUnit,
  isLoading,
}: RunningPaceTrendChartProps) {
  const navigate = useNavigate();
  const [selectedRunningExerciseId, setSelectedRunningExerciseId] =
    useState("");
  const [chooserTarget, setChooserTarget] =
    useState<WorkoutChooserTarget | null>(null);

  function openWorkoutForPoint(point: RunningPaceTrendPoint) {
    if (point.workoutIds.length === 0) return;
    if (point.workoutIds.length === 1) {
      navigate({
        to: "/workouts/$workoutId",
        params: { workoutId: point.workoutIds[0]! },
      });
      return;
    }
    setChooserTarget({
      workoutIds: point.workoutIds,
      label: formatDateLabel(point.date),
      description: point.exerciseName,
    });
  }

  const exerciseOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const point of data) {
      byId.set(point.exerciseId, point.exerciseName);
    }
    return Array.from(byId.entries()).map(([id, name]) => ({ id, name }));
  }, [data]);

  useEffect(() => {
    if (exerciseOptions.length === 0) {
      setSelectedRunningExerciseId("");
      return;
    }

    if (
      !selectedRunningExerciseId ||
      !exerciseOptions.some((option) => option.id === selectedRunningExerciseId)
    ) {
      setSelectedRunningExerciseId(exerciseOptions[0]!.id);
    }
  }, [exerciseOptions, selectedRunningExerciseId]);

  const activeRunningExerciseId =
    selectedRunningExerciseId || exerciseOptions[0]?.id || "";

  const selectedData = useMemo(() => {
    if (!activeRunningExerciseId) return [];
    return data.filter((point) => point.exerciseId === activeRunningExerciseId);
  }, [activeRunningExerciseId, data]);

  if (isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (!activeRunningExerciseId || selectedData.length === 0) {
    return (
      <div className="space-y-3">
        <Select value="" disabled>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="No run pace data yet" />
          </SelectTrigger>
        </Select>
        <div className="flex h-56 items-center justify-center rounded-md border border-dashed">
          <p className="text-sm text-muted-foreground">
            No pace data in the selected range.
          </p>
        </div>
      </div>
    );
  }

  const metersPerUnit = distanceUnit === "mi" ? 1609.344 : 1000;

  const chartData = selectedData.map((point) => ({
    ...point,
    label: formatDateLabel(point.date),
    paceMinPerUnit: (point.averagePace * metersPerUnit) / 60,
  }));

  return (
    <div className="space-y-3">
      <Select
        value={activeRunningExerciseId}
        onValueChange={(value) => setSelectedRunningExerciseId(value ?? "")}
      >
        <SelectTrigger className="w-[220px]">
          <SelectValue placeholder="Select exercise" />
        </SelectTrigger>
        <SelectContent>
          {exerciseOptions.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <ResponsiveContainer width="100%" height={256}>
        <LineChart
          data={chartData}
          margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
          onClick={(state) => {
            const index = Number(state?.activeIndex);
            const point = Number.isInteger(index)
              ? chartData[index]
              : undefined;
            if (point) openWorkoutForPoint(point);
          }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            width={56}
            tickFormatter={(v: number) => formatPaceFromMinPerUnit(v)}
          />
          <Tooltip
            formatter={(value) => [
              `${formatPaceFromMinPerUnit(value as number)} min/${distanceUnit}`,
              "Average Pace",
            ]}
            labelFormatter={(label) => `Date: ${String(label)}`}
            labelStyle={{ color: "var(--muted-foreground)" }}
            contentStyle={{ fontSize: 12 }}
          />
          <Line
            type="monotone"
            dataKey="paceMinPerUnit"
            stroke="var(--chart-2)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--chart-2)" }}
            activeDot={{ r: 5, cursor: "pointer" }}
          />
        </LineChart>
      </ResponsiveContainer>

      <p className="text-xs text-muted-foreground">
        Tip: click a point to open that run.
      </p>

      <WorkoutChooserDialog
        target={chooserTarget}
        onOpenChange={(open) => {
          if (!open) setChooserTarget(null);
        }}
      />
    </div>
  );
}
