import { Dimensions, Text, View } from "react-native";
import { CartesianChart, Area } from "victory-native";
import { formatDateLabel } from "@src/api/lib/chart-formatters";

interface SleepRow {
  id: string;
  whoopSleepId: string;
  start: Date;
  end: Date;
  nap: boolean;
  scoreState: string | null;
  performancePct: number | null;
  efficiencyPct: number | null;
  totalInBedMilli: number | null;
}

interface NativeWhoopSleepChartProps {
  data: SleepRow[];
  isLoading: boolean;
}

const CHART_WIDTH = Dimensions.get("window").width - 48;

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

export function NativeWhoopSleepChart({
  data,
  isLoading,
}: NativeWhoopSleepChartProps) {
  if (isLoading) {
    return <View className="h-48 bg-muted rounded-md animate-pulse" />;
  }

  // Only show main sleeps (not naps)
  const mainSleeps = data.filter((s) => !s.nap);

  if (mainSleeps.length === 0) {
    return (
      <View className="h-48 items-center justify-center border border-dashed border-border rounded-md px-4">
        <Text className="text-sm text-muted text-center">
          No sleep sessions imported yet. Sleep data will appear here once Whoop
          starts sending events.
        </Text>
      </View>
    );
  }

  const sorted = mainSleeps
    .slice()
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  const chartData = sorted.map((s, i) => ({
    x: i,
    performancePct: s.performancePct != null ? Math.round(s.performancePct) : 0,
    label: formatDateLabel(new Date(s.start).toISOString().slice(0, 10)),
  }));

  return (
    <View className="space-y-4">
      {/* Trend chart */}
      <View style={{ height: 200, width: CHART_WIDTH }}>
        <CartesianChart
          data={chartData}
          xKey="x"
          yKeys={["performancePct"]}
          domain={{ y: [0, 100] }}
          axisOptions={{
            font: null,
            tickCount: { x: Math.min(chartData.length, 5), y: 4 },
          }}
        >
          {({ points, chartBounds }) => (
            <Area
              points={points.performancePct}
              color="#6366f1"
              strokeWidth={2}
              y0={chartBounds.bottom}
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
          <Text className="w-20 text-xs text-muted font-medium">In Bed</Text>
          <Text className="w-20 text-xs text-muted font-medium">Perf.</Text>
          <Text className="w-20 text-xs text-muted font-medium">Eff.</Text>
        </View>
        {mainSleeps.map((s) => (
          <View key={s.id} className="flex-row border-b border-border/30 py-1">
            <Text className="flex-1 text-sm text-foreground">
              {new Date(s.start).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </Text>
            <Text className="w-20 text-sm text-foreground">
              {formatDuration(s.totalInBedMilli)}
            </Text>
            <Text className="w-20 text-sm font-medium text-foreground">
              {formatPct(s.performancePct)}
            </Text>
            <Text className="w-20 text-sm text-foreground">
              {formatPct(s.efficiencyPct)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
