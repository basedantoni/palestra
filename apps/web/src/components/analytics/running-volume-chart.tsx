import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Skeleton } from "@/components/ui/skeleton";
import type { WeeklyRunningVolumePoint } from "@src/api/lib/analytics-queries";

interface RunningVolumeChartProps {
  data: WeeklyRunningVolumePoint[];
  distanceUnit: "mi" | "km";
  isLoading: boolean;
}

function formatPeriodLabel(period: string): string {
  const week = period.split("-W")[1];
  return week ? `W${Number(week)}` : period;
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function RunningVolumeChart({
  data,
  distanceUnit,
  isLoading,
}: RunningVolumeChartProps) {
  if (isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (data.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center rounded-md border border-dashed">
        <p className="text-sm text-muted-foreground">
          No running volume yet. Log a run to see weekly distance.
        </p>
      </div>
    );
  }

  const chartData = data.map((point) => ({
    ...point,
    label: formatPeriodLabel(point.period),
  }));

  return (
    <ResponsiveContainer width="100%" height={256}>
      <BarChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
        />
        <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} width={44} />
        <Tooltip
          formatter={(value, name, item) => {
            if (name === "totalDistance") {
              return [`${Number(value).toFixed(2)} ${distanceUnit}`, "Distance"];
            }
            if (name === "workoutCount") {
              return [String(value), "Runs"];
            }
            return [String(value), name];
          }}
          labelFormatter={(_, payload) => {
            const point = payload?.[0]?.payload as WeeklyRunningVolumePoint | undefined;
            if (!point) return "";
            return `${point.period} • ${formatDuration(point.totalDurationSeconds)}`;
          }}
          contentStyle={{ fontSize: 12 }}
        />
        <Bar dataKey="totalDistance" fill="var(--chart-1)" radius={[0, 0, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
