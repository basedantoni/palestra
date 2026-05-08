import { Dimensions, Text, View } from "react-native";
import { CartesianChart, Line } from "victory-native";
import { formatDateLabel } from "@src/api/lib/chart-formatters";

interface RecoveryRow {
  id: string;
  whoopCycleId: string;
  createdAt: Date;
  updatedAt: Date;
  scoreState: string | null;
  recoveryScore: number | null;
  restingHr: number | null;
  hrv: number | null;
  spo2Pct: number | null;
  skinTempCelsius: number | null;
  userCalibrating: boolean;
}

interface NativeWhoopRecoveryChartProps {
  data: RecoveryRow[];
  isLoading: boolean;
}

const CHART_WIDTH = Dimensions.get("window").width - 48;

/**
 * Returns a tailwind color class for a recovery score:
 * - green (≥67)
 * - yellow (34–66)
 * - red (≤33)
 */
function recoveryColorHex(score: number | null): string {
  if (score == null) return "#6b7280"; // gray
  if (score >= 67) return "#22c55e";   // green-500
  if (score >= 34) return "#eab308";   // yellow-500
  return "#ef4444";                    // red-500
}

function formatHr(val: number | null): string {
  if (val == null) return "—";
  return `${Math.round(val)} bpm`;
}

function formatHrv(val: number | null): string {
  if (val == null) return "—";
  return `${val.toFixed(1)} ms`;
}

export function NativeWhoopRecoveryChart({
  data,
  isLoading,
}: NativeWhoopRecoveryChartProps) {
  if (isLoading) {
    return <View className="h-48 bg-muted rounded-md animate-pulse" />;
  }

  if (data.length === 0) {
    return (
      <View className="h-48 items-center justify-center border border-dashed border-border rounded-md px-4">
        <Text className="text-sm text-muted text-center">
          No recovery data imported yet. Recovery scores will appear here once Whoop
          starts sending events.
        </Text>
      </View>
    );
  }

  const sorted = data
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  const chartData = sorted.map((r, i) => ({
    x: i,
    recoveryScore: r.recoveryScore != null ? Math.round(r.recoveryScore) : 0,
    label: formatDateLabel(new Date(r.createdAt).toISOString().slice(0, 10)),
  }));

  // Use green as the default line color; individual coloring not supported per-point in victory-native easily
  const lineColor = "#22c55e";

  return (
    <View className="space-y-4">
      {/* Trend chart */}
      <View style={{ height: 200, width: CHART_WIDTH }}>
        <CartesianChart
          data={chartData}
          xKey="x"
          yKeys={["recoveryScore"]}
          domain={{ y: [0, 100] }}
          axisOptions={{
            font: null,
            tickCount: { x: Math.min(chartData.length, 5), y: 4 },
          }}
        >
          {({ points }) => (
            <Line
              points={points.recoveryScore}
              color={lineColor}
              strokeWidth={2}
              animate={{ type: "timing", duration: 300 }}
            />
          )}
        </CartesianChart>
      </View>

      {/* Session list */}
      <View className="space-y-2">
        {/* Header */}
        <View className="flex-row border-b border-border pb-1">
          <Text className="flex-1 text-xs text-muted font-medium">Date</Text>
          <Text className="w-16 text-xs text-muted font-medium">Score</Text>
          <Text className="w-24 text-xs text-muted font-medium">RHR</Text>
          <Text className="w-20 text-xs text-muted font-medium">HRV</Text>
        </View>
        {sorted.map((r) => (
          <View key={r.id} className="flex-row border-b border-border/30 py-1">
            <Text className="flex-1 text-sm text-foreground">
              {new Date(r.createdAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </Text>
            <Text
              className="w-16 text-sm font-semibold"
              style={{ color: recoveryColorHex(r.recoveryScore) }}
            >
              {r.recoveryScore != null ? `${Math.round(r.recoveryScore)}` : "—"}
            </Text>
            <Text className="w-24 text-sm text-foreground">{formatHr(r.restingHr)}</Text>
            <Text className="w-20 text-sm text-foreground">{formatHrv(r.hrv)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
