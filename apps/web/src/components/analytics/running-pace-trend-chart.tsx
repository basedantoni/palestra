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
import type { RunningPaceTrendPoint } from "@src/api/lib/analytics-queries";

interface RunningPaceTrendChartProps {
  data: RunningPaceTrendPoint[];
  distanceUnit: "mi" | "km";
  exerciseOptions: Array<{ id: string; name: string }>;
  selectedExerciseId?: string;
  onExerciseChange: (exerciseId: string | null, eventDetails: unknown) => void;
  isLoading: boolean;
}

function formatDateLabel(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function RunningPaceTrendChart({
  data,
  distanceUnit,
  exerciseOptions,
  selectedExerciseId,
  onExerciseChange,
  isLoading,
}: RunningPaceTrendChartProps) {
  if (isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (!selectedExerciseId || data.length === 0) {
    return (
      <div className="space-y-3">
        <Select disabled>
          <SelectTrigger className="w-[220px]">
            <SelectValue placeholder="No run pace data yet" />
          </SelectTrigger>
        </Select>
        <div className="flex h-56 items-center justify-center rounded-md border border-dashed">
          <p className="text-sm text-muted-foreground">
            No pace data yet. Log a run with pace to see the trend.
          </p>
        </div>
      </div>
    );
  }

  const metersPerUnit = distanceUnit === "mi" ? 1609.344 : 1000;

  const chartData = data.map((point) => ({
    ...point,
    label: formatDateLabel(point.date),
    paceMinPerUnit: (point.averagePace * metersPerUnit) / 60,
  }));

  function formatPace(minPerUnit: number): string {
    const mins = Math.floor(minPerUnit);
    const secs = Math.round((minPerUnit - mins) * 60);
    return `${mins}:${String(secs).padStart(2, "0")}`;
  }

  return (
    <div className="space-y-3">
      <Select value={selectedExerciseId} onValueChange={onExerciseChange}>
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
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            width={56}
            tickFormatter={(v: number) => formatPace(v)}
          />
          <Tooltip
            formatter={(value) => [
              `${formatPace(value as number)} min/${distanceUnit}`,
              "Average Pace",
            ]}
            labelFormatter={(label) => `Date: ${String(label)}`}
            labelStyle={{ color: "var(--muted-foreground" }}
            contentStyle={{ fontSize: 12 }}
          />
          <Line
            type="monotone"
            dataKey="paceMinPerUnit"
            stroke="var(--chart-2)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--chart-2)" }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
