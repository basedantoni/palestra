import { Card } from "heroui-native";
import { Text, View } from "react-native";

import {
  RECORD_TYPE_LABELS,
  formatPrValue,
  formatPrDelta,
  isPrImprovement,
} from "@src/api/lib/pr-formatters";

interface PersonalRecordEntry {
  recordType: string;
  value: number;
  delta: number | null;
  dateAchieved: Date | string;
}

interface ExerciseGroup {
  exerciseId: string;
  exerciseName: string;
  records: PersonalRecordEntry[];
}

interface NativePersonalRecordsProps {
  data: ExerciseGroup[];
  isLoading: boolean;
  distanceUnit?: "mi" | "km";
}

export function NativePersonalRecords({
  data,
  isLoading,
  distanceUnit = "mi",
}: NativePersonalRecordsProps) {
  if (isLoading) {
    return (
      <View className="h-32 bg-muted rounded-md animate-pulse" />
    );
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
          <View className="gap-2">
            {exercise.records.map((record, i) => (
              <View key={i} className="flex-row items-center justify-between">
                <View className="bg-secondary px-2 py-0.5 rounded">
                  <Text className="text-xs text-secondary-foreground">
                    {RECORD_TYPE_LABELS[record.recordType] ?? record.recordType}
                  </Text>
                </View>
                <Text className="text-sm font-medium text-foreground">
                  {formatPrValue(record.recordType, record.value, distanceUnit)}
                </Text>
                {record.delta != null ? (
                  <Text
                    className={`text-xs font-medium ${
                      isPrImprovement(record.recordType, record.delta)
                        ? "text-green-600"
                        : "text-red-500"
                    }`}
                  >
                    {formatPrDelta(record.recordType, record.delta, distanceUnit)}
                  </Text>
                ) : (
                  <Text className="text-xs text-muted">First PR</Text>
                )}
              </View>
            ))}
          </View>
        </Card>
      ))}
    </View>
  );
}
