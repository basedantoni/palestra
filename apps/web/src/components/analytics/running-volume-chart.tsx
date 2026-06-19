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
import type { WeeklyRunningVolumePoint } from "@life-tracker/api/lib/analytics-queries";
import {
  metersToDisplayUnit,
  formatPeriodLabel,
  formatChartDuration,
} from "@life-tracker/api/lib/index";

interface RunningVolumeChartProps {
  data: WeeklyRunningVolumePoint[];
  distanceUnit: "mi" | "km";
  isLoading: boolean;
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
          No running volume in the selected range.
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
      <BarChart
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
          width={44}
        />
        <Tooltip
          formatter={(value, name, _item) => {
            if (name === "totalDistance") {
              return [
                metersToDisplayUnit(Number(value), distanceUnit).toFixed(2),
                "Distance",
              ];
            }
            if (name === "workoutCount") {
              return [String(value), "Runs"];
            }
            return [String(value), name];
          }}
          labelFormatter={(_, payload) => {
            const point = payload?.[0]?.payload as
              | WeeklyRunningVolumePoint
              | undefined;
            if (!point) return "";
            return `${point.period} • ${formatChartDuration(point.totalDurationSeconds)}`;
          }}
          labelStyle={{ color: "var(--muted-foreground)" }}
          contentStyle={{ fontSize: 12 }}
        />
        <Bar
          dataKey="totalDistance"
          fill="var(--chart-1)"
          radius={[0, 0, 0, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
