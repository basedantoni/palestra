import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface MuscleGroupDataRow {
  weekStartDate: string;
  muscleGroup: string;
  totalVolume: number;
}

interface MuscleGroupChartProps {
  data: MuscleGroupDataRow[];
  categorizationSystem: "bodybuilding" | "movement_patterns";
  onSystemChange: (s: "bodybuilding" | "movement_patterns") => void;
  isLoading: boolean;
}

const MUSCLE_GROUP_COLORS: Record<string, string> = {
  chest: "#ef4444",
  back: "#3b82f6",
  shoulders: "#f59e0b",
  arms: "#8b5cf6",
  legs: "#10b981",
  core: "#ec4899",
};

const MOVEMENT_COLORS: Record<string, string> = {
  push: "#ef4444",
  pull: "#3b82f6",
  squat: "#10b981",
  hinge: "#f59e0b",
  carry: "#8b5cf6",
};

function formatYAxis(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(0)}k`;
  return String(value);
}

function formatWeekLabel(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleString("en-US", { month: "short", day: "numeric" });
}

export function MuscleGroupChart({
  data,
  categorizationSystem,
  onSystemChange,
  isLoading,
}: MuscleGroupChartProps) {
  if (isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  const colors =
    categorizationSystem === "bodybuilding" ? MUSCLE_GROUP_COLORS : MOVEMENT_COLORS;

  // Pivot: group by week, one key per muscle group
  const weekMap = new Map<string, Record<string, number>>();
  for (const row of data) {
    const existing = weekMap.get(row.weekStartDate) ?? {};
    existing[row.muscleGroup] = (existing[row.muscleGroup] ?? 0) + row.totalVolume;
    weekMap.set(row.weekStartDate, existing);
  }

  const chartData = Array.from(weekMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStartDate, volumes]) => ({
      label: formatWeekLabel(weekStartDate),
      ...volumes,
    }));

  const muscleGroups = Array.from(
    new Set(data.map((r) => r.muscleGroup)),
  ).sort();

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant={categorizationSystem === "bodybuilding" ? "default" : "outline"}
          onClick={() => onSystemChange("bodybuilding")}
        >
          Bodybuilding
        </Button>
        <Button
          size="sm"
          variant={categorizationSystem === "movement_patterns" ? "default" : "outline"}
          onClick={() => onSystemChange("movement_patterns")}
        >
          Movement Patterns
        </Button>
      </div>

      {chartData.length === 0 ? (
        <div className="flex h-48 items-center justify-center rounded-md border border-dashed">
          <p className="text-sm text-muted-foreground">
            No muscle group data yet.
          </p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={256}>
          <BarChart
            data={chartData}
            margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={formatYAxis} tick={{ fontSize: 11 }} width={40} />
            <Tooltip
              formatter={(value, name) => [
                typeof value === "number"
                  ? `${value.toLocaleString()} lbs`
                  : value,
                name,
              ]}
              contentStyle={{ fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {muscleGroups.map((mg) => (
              <Bar
                key={mg}
                dataKey={mg}
                stackId="volume"
                fill={colors[mg] ?? "#94a3b8"}
                name={mg.charAt(0).toUpperCase() + mg.slice(1)}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
