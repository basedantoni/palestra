import { Dimensions, Text, View } from "react-native";
import { CartesianChart, Line } from "victory-native";

interface HrTrendPoint {
  date: string;
  avgHr: number | null;
}

interface NativeWhoopHrTrendProps {
  data: HrTrendPoint[];
  isLoading: boolean;
}

const CHART_WIDTH = Dimensions.get("window").width - 48;

function formatDateLabel(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function NativeWhoopHrTrend({ data, isLoading }: NativeWhoopHrTrendProps) {
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

  // victory-native requires numeric x keys; use index as x and label separately
  const chartData = data.map((point, i) => ({
    x: i,
    avgHr: point.avgHr ?? 0,
    label: formatDateLabel(point.date),
  }));

  return (
    <View style={{ height: 200, width: CHART_WIDTH }}>
      <CartesianChart
        data={chartData}
        xKey="x"
        yKeys={["avgHr"]}
        axisOptions={{
          font: null,
          tickCount: { x: Math.min(chartData.length, 5), y: 4 },
        }}
      >
        {({ points }) => (
          <Line
            points={points.avgHr}
            color="#ef4444"
            strokeWidth={2}
            animate={{ type: "timing", duration: 300 }}
          />
        )}
      </CartesianChart>
    </View>
  );
}
