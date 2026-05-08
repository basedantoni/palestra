import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Skeleton } from "@/components/ui/skeleton";
import { formatDateLabel } from "@src/api/lib/index";

interface RecoveryRow {
  id: string;
  whoopCycleId: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  scoreState: string | null;
  recoveryScore: number | null;
  restingHr: number | null;
  hrv: number | null;
  spo2Pct: number | null;
  skinTempCelsius: number | null;
  userCalibrating: boolean;
}

interface WhoopRecoveryChartProps {
  data: RecoveryRow[];
  isLoading: boolean;
}

/**
 * Returns a color for a recovery score:
 * - green (≥67)
 * - yellow (34–66)
 * - red (≤33)
 */
function recoveryColor(score: number | null): string {
  if (score == null) return "var(--muted-foreground)";
  if (score >= 67) return "#22c55e"; // green-500
  if (score >= 34) return "#eab308"; // yellow-500
  return "#ef4444"; // red-500
}

function formatHr(val: number | null): string {
  if (val == null) return "—";
  return `${Math.round(val)} bpm`;
}

function formatHrv(val: number | null): string {
  if (val == null) return "—";
  return `${val.toFixed(1)} ms`;
}

function formatScore(val: number | null): string {
  if (val == null) return "—";
  return `${Math.round(val)}`;
}

export function WhoopRecoveryChart({ data, isLoading }: WhoopRecoveryChartProps) {
  if (isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (data.length === 0) {
    return (
      <div className="flex h-56 items-center justify-center rounded-md border border-dashed">
        <p className="text-sm text-muted-foreground">
          No recovery data imported yet. Recovery scores will appear here once Whoop
          starts sending events.
        </p>
      </div>
    );
  }

  const sorted = data
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const chartData = sorted.map((r) => ({
    label: formatDateLabel(new Date(r.createdAt).toISOString().slice(0, 10)),
    recoveryScore: r.recoveryScore,
    color: recoveryColor(r.recoveryScore),
  }));

  return (
    <div className="space-y-6">
      {/* Trend chart */}
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
            domain={[0, 100]}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            width={44}
          />
          <Tooltip
            formatter={(value) =>
              value != null ? [`${value}`, "Recovery Score"] : ["—", "Recovery Score"]
            }
            labelFormatter={(label) => `Date: ${String(label)}`}
            labelStyle={{ color: "var(--muted-foreground)" }}
            contentStyle={{ fontSize: 12 }}
          />
          <Line
            type="monotone"
            dataKey="recoveryScore"
            strokeWidth={2}
            dot={(props) => {
              const { cx, cy, payload } = props as { cx: number; cy: number; payload: { color: string } };
              return (
                <circle
                  key={`dot-${cx}-${cy}`}
                  cx={cx}
                  cy={cy}
                  r={4}
                  fill={payload.color}
                  stroke={payload.color}
                />
              );
            }}
            activeDot={{ r: 6 }}
            connectNulls={false}
            stroke="var(--muted-foreground)"
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} stroke={entry.color} />
            ))}
          </Line>
        </LineChart>
      </ResponsiveContainer>

      {/* Session list */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="pb-2 font-medium">Date</th>
              <th className="pb-2 font-medium">Score</th>
              <th className="pb-2 font-medium">RHR</th>
              <th className="pb-2 font-medium">HRV</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id} className="border-b border-border/50 last:border-0">
                <td className="py-2 pr-4 text-foreground">
                  {new Date(r.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </td>
                <td
                  className="py-2 pr-4 font-semibold"
                  style={{ color: recoveryColor(r.recoveryScore) }}
                >
                  {formatScore(r.recoveryScore)}
                </td>
                <td className="py-2 pr-4 text-foreground">{formatHr(r.restingHr)}</td>
                <td className="py-2 text-foreground">{formatHrv(r.hrv)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
