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
import { metersToDisplayUnit } from "@src/api/lib/index";

interface WeeklyDistancePoint {
  weekStart: string;
  distanceMeter: number;
}

interface WhoopWeeklyDistanceChartProps {
  data: WeeklyDistancePoint[];
  distanceUnit: "mi" | "km";
  isLoading: boolean;
}

function formatWeekLabel(weekStart: string): string {
  const parsed = new Date(`${weekStart}T12:00:00`);
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function WhoopWeeklyDistanceChart({
  data,
  distanceUnit,
  isLoading,
}: WhoopWeeklyDistanceChartProps) {
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
    label: formatWeekLabel(point.weekStart),
    distance: metersToDisplayUnit(point.distanceMeter, distanceUnit),
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
          width={52}
          tickFormatter={(val) =>
            typeof val === "number" ? val.toFixed(1) : String(val)
          }
          label={{
            value: distanceUnit,
            angle: -90,
            position: "insideLeft",
            offset: -4,
            style: { fontSize: 10, fill: "var(--muted-foreground)" },
          }}
        />
        <Tooltip
          formatter={(value) => [
            `${Number(value).toFixed(2)} ${distanceUnit}`,
            "Distance",
          ]}
          labelFormatter={(label) => `Week of ${String(label)}`}
          labelStyle={{ color: "var(--muted-foreground" }}
          contentStyle={{ fontSize: 12 }}
        />
        <Bar dataKey="distance" fill="var(--chart-1)" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
