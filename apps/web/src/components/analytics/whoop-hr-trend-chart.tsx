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

interface HrTrendPoint {
  date: string;
  avgHr: number | null;
}

interface WhoopHrTrendChartProps {
  data: HrTrendPoint[];
  isLoading: boolean;
}

function formatDateLabel(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function WhoopHrTrendChart({ data, isLoading }: WhoopHrTrendChartProps) {
  if (isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (data.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center rounded-md border border-dashed">
        <p className="text-sm text-muted-foreground">
          No Whoop-linked runs in this period.
        </p>
      </div>
    );
  }

  const chartData = data.map((point) => ({
    label: formatDateLabel(point.date),
    avgHr: point.avgHr,
  }));

  return (
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
          width={44}
          unit=" bpm"
        />
        <Tooltip
          formatter={(value) =>
            value != null ? [`${value} bpm`, "Avg HR"] : ["—", "Avg HR"]
          }
          labelFormatter={(label) => `Date: ${String(label)}`}
          labelStyle={{ color: "var(--muted-foreground" }}
          contentStyle={{ fontSize: 12 }}
        />
        <Line
          type="monotone"
          dataKey="avgHr"
          stroke="var(--chart-3)"
          strokeWidth={2}
          dot={{ r: 3, fill: "var(--chart-3)" }}
          activeDot={{ r: 5 }}
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
