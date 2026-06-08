import { Card } from "heroui-native";
import { Text, View } from "react-native";

import {
  RECORD_TYPE_LABELS,
  formatPrValue,
  formatPrDelta,
  isPrImprovement,
} from "@src/api/lib/pr-formatters";

interface ProgressionEntry {
  value: number;
  dateAchieved: Date | string;
  previousRecordValue: number | null;
}

interface RecordsByType {
  recordType: string;
  currentBest: number;
  progression: ProgressionEntry[];
}

interface ExerciseGroup {
  exerciseId: string;
  exerciseName: string;
  recordsByType: RecordsByType[];
}

interface NativePersonalRecordsProps {
  data: ExerciseGroup[];
  isLoading: boolean;
  distanceUnit?: "mi" | "km";
}

function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function ProgressionTimeline({
  recordType,
  progression,
  distanceUnit,
}: {
  recordType: string;
  progression: ProgressionEntry[];
  distanceUnit: "mi" | "km";
}) {
  // Render newest → oldest so the most recent PR reads first.
  const ordered = [...progression].reverse();

  return (
    <View className="mt-2 gap-2 border-l border-border pl-3">
      {ordered.map((entry, i) => {
        const delta =
          entry.previousRecordValue != null
            ? entry.value - entry.previousRecordValue
            : null;
        return (
          <View key={i}>
            <View className="flex-row items-center justify-between">
              <Text className="text-sm font-medium text-foreground">
                {formatPrValue(recordType, entry.value, distanceUnit)}
              </Text>
              {delta != null ? (
                <Text
                  className={`text-xs font-medium ${
                    isPrImprovement(recordType, delta)
                      ? "text-green-600"
                      : "text-red-500"
                  }`}
                >
                  {formatPrDelta(recordType, delta, distanceUnit)}
                </Text>
              ) : (
                <Text className="text-xs text-muted">First PR</Text>
              )}
            </View>
            <Text className="text-xs text-muted">
              {formatDate(entry.dateAchieved)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function NativePersonalRecords({
  data,
  isLoading,
  distanceUnit = "mi",
}: NativePersonalRecordsProps) {
  if (isLoading) {
    return <View className="h-32 bg-muted rounded-md animate-pulse" />;
  }

  if (data.length === 0) {
    return (
      <View className="h-24 items-center justify-center border border-dashed border-border rounded-md">
        <Text className="text-sm text-muted">
          No personal records yet. Keep training!
        </Text>
      </View>
    );
  }

  return (
    <View className="gap-3">
      {data.map((exercise) => (
        <Card key={exercise.exerciseId} variant="secondary" className="p-4">
          <Text className="text-sm font-semibold text-foreground mb-3">
            {exercise.exerciseName}
          </Text>
          <View className="gap-4">
            {exercise.recordsByType.map((rt) => (
              <View key={rt.recordType}>
                <View className="flex-row items-center justify-between">
                  <View className="bg-secondary px-2 py-0.5 rounded">
                    <Text className="text-xs text-secondary-foreground">
                      {RECORD_TYPE_LABELS[rt.recordType] ?? rt.recordType}
                    </Text>
                  </View>
                  <Text className="text-base font-bold text-foreground">
                    {formatPrValue(rt.recordType, rt.currentBest, distanceUnit)}
                  </Text>
                </View>
                {rt.progression.length > 1 ? (
                  <ProgressionTimeline
                    recordType={rt.recordType}
                    progression={rt.progression}
                    distanceUnit={distanceUnit}
                  />
                ) : null}
              </View>
            ))}
          </View>
        </Card>
      ))}
    </View>
  );
}
