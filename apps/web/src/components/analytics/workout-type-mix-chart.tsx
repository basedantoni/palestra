import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Skeleton } from "@/components/ui/skeleton";
import { WORKOUT_TYPE_LABELS } from "@src/api/lib/index";
import type { WorkoutTypeMixPoint } from "@src/api/lib/analytics-queries";

interface WorkoutTypeMixChartProps {
  data: WorkoutTypeMixPoint[];
  isLoading: boolean;
}

const TYPE_COLORS: Record<WorkoutTypeMixPoint["workoutType"], string> = {
  weightlifting: "var(--chart-1)",
  hiit: "var(--chart-2)",
  cardio: "var(--chart-3)",
  mobility: "var(--chart-4)",
  calisthenics: "var(--chart-5)",
  yoga: "var(--chart-2)",
  sports: "var(--chart-3)",
  mixed: "var(--chart-4)",
};

function formatPeriodLabel(period: string): string {
  const week = period.split("-W")[1];
  return week ? `W${Number(week)}` : period;
}

export function WorkoutTypeMixChart({
  data,
  isLoading,
}: WorkoutTypeMixChartProps) {
  if (isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (data.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center rounded-md border border-dashed">
        <p className="text-sm text-muted-foreground">
          No workout mix data yet.
        </p>
      </div>
    );
  }

  const workoutTypes = Array.from(new Set(data.map((point) => point.workoutType)));
  const periodMap = new Map<string, Record<string, number | string>>();

  for (const point of data) {
    const existing = periodMap.get(point.period) ?? {
      period: point.period,
      label: formatPeriodLabel(point.period),
    };
    existing[point.workoutType] = point.workoutCount;
    periodMap.set(point.period, existing);
  }

  const chartData = Array.from(periodMap.values());

  return (
    <ResponsiveContainer width="100%" height={256}>
      <BarChart data={chartData} margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
        />
        <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} width={32} />
        <Tooltip contentStyle={{ fontSize: 12 }} />
        <Legend
          formatter={(value) =>
            WORKOUT_TYPE_LABELS[value as keyof typeof WORKOUT_TYPE_LABELS] ?? value
          }
        />
        {workoutTypes.map((workoutType) => (
          <Bar
            key={workoutType}
            dataKey={workoutType}
            stackId="workouts"
            fill={TYPE_COLORS[workoutType]}
            name={workoutType}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
