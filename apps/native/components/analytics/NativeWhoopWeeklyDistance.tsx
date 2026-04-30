import { Dimensions, Text, View } from "react-native";
import { CartesianChart, Bar } from "victory-native";

interface WeeklyDistancePoint {
  weekStart: string;
  distanceMeter: number;
}

interface NativeWhoopWeeklyDistanceProps {
  data: WeeklyDistancePoint[];
  distanceUnit: "mi" | "km";
  isLoading: boolean;
}

const CHART_WIDTH = Dimensions.get("window").width - 48;
const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;

function metersToUnit(meters: number, unit: "mi" | "km"): number {
  return unit === "mi" ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
}

function formatWeekLabel(weekStart: string): string {
  const parsed = new Date(`${weekStart}T12:00:00`);
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function NativeWhoopWeeklyDistance({
  data,
  distanceUnit,
  isLoading,
}: NativeWhoopWeeklyDistanceProps) {
  if (isLoading) {
    return <View className="h-48 bg-muted rounded-md animate-pulse" />;
  }

  if (data.length === 0) {
    return (
      <View className="h-48 items-center justify-center border border-dashed border-border rounded-md">
        <Text className="text-sm text-muted text-center px-4">
          No Whoop-linked runs in this period.
        </Text>
      </View>
    );
  }

  const chartData = data.map((point, i) => ({
    x: i,
    distance: metersToUnit(point.distanceMeter, distanceUnit),
    label: formatWeekLabel(point.weekStart),
  }));

  return (
    <View>
      <Text className="text-xs text-muted mb-2">Distance ({distanceUnit})</Text>
      <View style={{ height: 200, width: CHART_WIDTH }}>
        <CartesianChart
          data={chartData}
          xKey="x"
          yKeys={["distance"]}
          axisOptions={{
            font: null,
            tickCount: { x: Math.min(chartData.length, 6), y: 4 },
          }}
        >
          {({ points, chartBounds }) => (
            <Bar
              points={points.distance}
              chartBounds={chartBounds}
              color="#6366f1"
              animate={{ type: "timing", duration: 300 }}
            />
          )}
        </CartesianChart>
      </View>
    </View>
  );
}
