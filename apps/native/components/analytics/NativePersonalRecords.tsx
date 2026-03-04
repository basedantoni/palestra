import { Card } from "heroui-native";
import { Text, View } from "react-native";

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
}

const RECORD_TYPE_LABELS: Record<string, string> = {
  max_weight: "Max Weight",
  max_reps: "Max Reps",
  max_volume: "Max Volume",
  best_pace: "Best Pace",
  longest_distance: "Longest Distance",
};

function formatValue(recordType: string, value: number): string {
  if (recordType === "max_weight") return `${value} lbs`;
  if (recordType === "max_reps") return `${value} reps`;
  if (recordType === "max_volume") return `${value.toLocaleString()} lbs`;
  if (recordType === "best_pace") return `${value} min/mi`;
  if (recordType === "longest_distance") return `${value} mi`;
  return String(value);
}

function formatDelta(recordType: string, delta: number): string {
  const unit =
    recordType === "max_weight" || recordType === "max_volume"
      ? " lbs"
      : recordType === "max_reps"
        ? " reps"
        : "";
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${delta}${unit}`;
}

export function NativePersonalRecords({
  data,
  isLoading,
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
                  {formatValue(record.recordType, record.value)}
                </Text>
                {record.delta != null ? (
                  <Text
                    className={`text-xs font-medium ${
                      record.delta >= 0 ? "text-green-600" : "text-red-500"
                    }`}
                  >
                    {formatDelta(record.recordType, record.delta)}
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
