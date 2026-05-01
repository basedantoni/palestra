import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Skeleton } from "@/components/ui/skeleton";
import type { MobilityFrequencyPoint } from "@src/api/lib/analytics-queries";

interface MobilityFrequencyChartProps {
  data: MobilityFrequencyPoint[];
  isLoading: boolean;
}

function formatPeriodLabel(period: string): string {
  const week = period.split("-W")[1];
  return week ? `W${Number(week)}` : period;
}

export function MobilityFrequencyChart({
  data,
  isLoading,
}: MobilityFrequencyChartProps) {
  if (isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (data.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center rounded-md border border-dashed">
        <p className="text-sm text-muted-foreground">No mobility data yet.</p>
      </div>
    );
  }

  const chartData = data.map((point) => ({
    ...point,
    label: formatPeriodLabel(point.period),
  }));

  return (
    <ResponsiveContainer width="100%" height={256}>
      <ComposedChart
        data={chartData}
        margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
        />
        <YAxis
          yAxisId="sessions"
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          width={36}
        />
        <YAxis
          yAxisId="minutes"
          orientation="right"
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          width={40}
        />
        <Tooltip
          formatter={(value, name) =>
            name === "sessionCount"
              ? [String(value), "Sessions"]
              : [`${value} min`, "Duration"]
          }
          contentStyle={{ fontSize: 12 }}
          labelStyle={{ color: "var(--muted-foreground" }}
        />
        <Bar yAxisId="sessions" dataKey="sessionCount" fill="var(--chart-4)" />
        <Line
          yAxisId="minutes"
          type="monotone"
          dataKey="totalDurationMinutes"
          stroke="var(--chart-1)"
          strokeWidth={2}
          dot={{ r: 3, fill: "var(--chart-1)" }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
