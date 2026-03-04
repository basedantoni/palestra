import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { VolumeDataPoint } from "@src/api/lib/analytics-queries";

interface VolumeOverTimeChartProps {
  data: VolumeDataPoint[];
  granularity: "weekly" | "monthly";
  onGranularityChange: (g: "weekly" | "monthly") => void;
  isLoading: boolean;
}

function formatYAxis(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(0)}k`;
  return String(value);
}

function formatPeriodLabel(period: string): string {
  // "2026-W09" -> "W9" or "2026-03" -> "Mar"
  if (period.includes("-W")) {
    const week = period.split("-W")[1];
    return `W${Number(week)}`;
  }
  const [year, month] = period.split("-");
  if (!year || !month) return period;
  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleString("en-US", { month: "short" });
}

export function VolumeOverTimeChart({
  data,
  granularity,
  onGranularityChange,
  isLoading,
}: VolumeOverTimeChartProps) {
  if (isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  const chartData = data.map((d) => ({
    ...d,
    label: formatPeriodLabel(d.period),
  }));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={granularity === "weekly" ? "default" : "outline"}
          onClick={() => onGranularityChange("weekly")}
        >
          Weekly
        </Button>
        <Button
          size="sm"
          variant={granularity === "monthly" ? "default" : "outline"}
          onClick={() => onGranularityChange("monthly")}
        >
          Monthly
        </Button>
      </div>

      {chartData.length === 0 ? (
        <div className="flex h-48 items-center justify-center rounded-md border border-dashed">
          <p className="text-sm text-muted-foreground">
            No volume data yet. Log some workouts to see your progress.
          </p>
        </div>
      ) : (
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
              tickFormatter={formatYAxis}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              width={40}
            />
            <Tooltip
              formatter={(value) => [
                typeof value === "number"
                  ? `${value.toLocaleString()} lbs`
                  : value,
                "Volume",
              ]}
              labelFormatter={(label) => `Period: ${String(label)}`}
              contentStyle={{ fontSize: 12 }}
            />
            <Line
              type="linear"
              dataKey="totalVolume"
              stroke="var(--chart-1)"
              strokeWidth={2}
              dot={{ r: 3, fill: "var(--chart-1)" }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
