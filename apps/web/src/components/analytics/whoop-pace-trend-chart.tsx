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

interface PaceTrendPoint {
  date: string;
  paceSecPerUnit: number | null;
  unit: "mi" | "km";
}

interface WhoopPaceTrendChartProps {
  data: PaceTrendPoint[];
  isLoading: boolean;
}

function formatDateLabel(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatPace(secPerUnit: number): string {
  const minutes = Math.floor(secPerUnit / 60);
  const seconds = Math.round(secPerUnit % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function WhoopPaceTrendChart({
  data,
  isLoading,
}: WhoopPaceTrendChartProps) {
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

  const unit = data[0]?.unit ?? "mi";
  const chartData = data.map((point) => ({
    label: formatDateLabel(point.date),
    paceSecPerUnit: point.paceSecPerUnit,
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
          width={56}
          tickFormatter={(val) =>
            typeof val === "number" ? formatPace(val) : String(val)
          }
          label={{
            value: `min/${unit}`,
            angle: -90,
            position: "insideLeft",
            offset: -4,
            style: { fontSize: 10, fill: "var(--muted-foreground)" },
          }}
        />
        <Tooltip
          formatter={(value) => {
            if (value == null) return ["—", `Pace (min/${unit})`];
            return [
              `${formatPace(Number(value))} /${unit}`,
              "Pace",
            ];
          }}
          labelFormatter={(label) => `Date: ${String(label)}`}
          contentStyle={{ fontSize: 12 }}
        />
        <Line
          type="monotone"
          dataKey="paceSecPerUnit"
          stroke="var(--chart-2)"
          strokeWidth={2}
          dot={{ r: 3, fill: "var(--chart-2)" }}
          activeDot={{ r: 5 }}
          connectNulls={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
