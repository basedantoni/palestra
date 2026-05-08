import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Skeleton } from "@/components/ui/skeleton";
import { formatDateLabel } from "@src/api/lib/index";

interface SleepRow {
  id: string;
  whoopSleepId: string;
  start: string | Date;
  end: string | Date;
  nap: boolean;
  scoreState: string | null;
  performancePct: number | null;
  consistencyPct: number | null;
  efficiencyPct: number | null;
  totalInBedMilli: number | null;
}

interface WhoopSleepChartProps {
  data: SleepRow[];
  isLoading: boolean;
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  const totalMinutes = Math.round(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatPct(val: number | null): string {
  if (val == null) return "—";
  return `${Math.round(val)}%`;
}

export function WhoopSleepChart({ data, isLoading }: WhoopSleepChartProps) {
  if (isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  // Only show main sleeps (not naps) for the trend chart
  const mainSleeps = data.filter((s) => !s.nap);

  if (mainSleeps.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center rounded-md border border-dashed">
        <p className="text-sm text-muted-foreground">
          No sleep sessions imported yet. Sleep data will appear here once Whoop
          starts sending events.
        </p>
      </div>
    );
  }

  const chartData = mainSleeps
    .slice()
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
    .map((s) => ({
      label: formatDateLabel(new Date(s.start).toISOString().slice(0, 10)),
      performancePct: s.performancePct != null ? Math.round(s.performancePct) : null,
    }));

  return (
    <div className="space-y-6">
      {/* Trend chart */}
      <ResponsiveContainer width="100%" height={256}>
        <AreaChart
          data={chartData}
          margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
        >
          <defs>
            <linearGradient id="sleepGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            width={44}
            unit="%"
          />
          <Tooltip
            formatter={(value) =>
              value != null ? [`${value}%`, "Sleep Performance"] : ["—", "Sleep Performance"]
            }
            labelFormatter={(label) => `Date: ${String(label)}`}
            labelStyle={{ color: "var(--muted-foreground)" }}
            contentStyle={{ fontSize: 12 }}
          />
          <Area
            type="monotone"
            dataKey="performancePct"
            stroke="var(--chart-1)"
            strokeWidth={2}
            fill="url(#sleepGradient)"
            dot={{ r: 3, fill: "var(--chart-1)" }}
            activeDot={{ r: 5 }}
            connectNulls={false}
          />
        </AreaChart>
      </ResponsiveContainer>

      {/* Session list */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="pb-2 font-medium">Date</th>
              <th className="pb-2 font-medium">In Bed</th>
              <th className="pb-2 font-medium">Performance</th>
              <th className="pb-2 font-medium">Efficiency</th>
            </tr>
          </thead>
          <tbody>
            {mainSleeps.map((s) => (
              <tr key={s.id} className="border-b border-border/50 last:border-0">
                <td className="py-2 pr-4 text-foreground">
                  {new Date(s.start).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </td>
                <td className="py-2 pr-4 text-foreground">
                  {formatDuration(s.totalInBedMilli)}
                </td>
                <td className="py-2 pr-4 font-medium text-foreground">
                  {formatPct(s.performancePct)}
                </td>
                <td className="py-2 text-foreground">
                  {formatPct(s.efficiencyPct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
