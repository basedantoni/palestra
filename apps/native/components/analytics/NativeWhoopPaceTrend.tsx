import { Dimensions, Text, View } from "react-native";
import { CartesianChart, Line } from "victory-native";

interface PaceTrendPoint {
  date: string;
  paceSecPerUnit: number | null;
  unit: "mi" | "km";
}

interface NativeWhoopPaceTrendProps {
  data: PaceTrendPoint[];
  isLoading: boolean;
}

const CHART_WIDTH = Dimensions.get("window").width - 48;

export function NativeWhoopPaceTrend({ data, isLoading }: NativeWhoopPaceTrendProps) {
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

  const unit = data[0]?.unit ?? "mi";

  // Filter to entries with pace data; include index for x axis
  const chartData = data
    .filter((point) => point.paceSecPerUnit != null)
    .map((point, i) => ({
      x: i,
      paceSecPerUnit: point.paceSecPerUnit!,
    }));

  if (chartData.length === 0) {
    return (
      <View className="h-48 items-center justify-center border border-dashed border-border rounded-md">
        <Text className="text-sm text-muted text-center px-4">
          No pace data available for linked runs.
        </Text>
      </View>
    );
  }

  return (
    <View>
      <Text className="text-xs text-muted mb-2">min/{unit} (lower = faster)</Text>
      <View style={{ height: 200, width: CHART_WIDTH }}>
        <CartesianChart
          data={chartData}
          xKey="x"
          yKeys={["paceSecPerUnit"]}
          axisOptions={{
            font: null,
            tickCount: { x: Math.min(chartData.length, 5), y: 4 },
          }}
        >
          {({ points }) => (
            <Line
              points={points.paceSecPerUnit}
              color="#6366f1"
              strokeWidth={2}
              animate={{ type: "timing", duration: 300 }}
            />
          )}
        </CartesianChart>
      </View>
    </View>
  );
}
