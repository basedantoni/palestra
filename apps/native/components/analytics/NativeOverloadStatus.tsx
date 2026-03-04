import { Card } from "heroui-native";
import { Text, View } from "react-native";

import { SuggestionBadge } from "@/components/workout/SuggestionBadge";

interface OverloadEntry {
  exerciseId: string;
  exerciseName: string | null;
  trendStatus: string;
  plateauCount: number;
  suggestion: {
    type: string;
    message: string;
    details: { currentValue: number; suggestedValue: number; unit: string };
  } | null;
  lastCalculatedAt: Date | string;
}

interface NativeOverloadStatusProps {
  data: OverloadEntry[];
  isLoading: boolean;
}

const TREND_ORDER = { improving: 0, plateau: 1, declining: 2 };

export function NativeOverloadStatus({
  data,
  isLoading,
}: NativeOverloadStatusProps) {
  if (isLoading) {
    return (
      <View className="h-32 bg-muted rounded-md animate-pulse" />
    );
  }

  if (data.length === 0) {
    return (
      <View className="h-24 items-center justify-center border border-dashed border-border rounded-md px-4">
        <Text className="text-sm text-muted text-center">
          No progressive overload data yet. You need at least 2 sessions per
          exercise for a suggestion to appear.
        </Text>
      </View>
    );
  }

  const sorted = [...data].sort((a, b) => {
    const aOrder =
      TREND_ORDER[a.trendStatus as keyof typeof TREND_ORDER] ?? 3;
    const bOrder =
      TREND_ORDER[b.trendStatus as keyof typeof TREND_ORDER] ?? 3;
    return aOrder - bOrder;
  });

  return (
    <View className="gap-3">
      {sorted.map((item) => (
        <Card key={item.exerciseId} variant="secondary" className="p-4">
          <View className="flex-row items-center justify-between mb-2">
            <Text
              className="text-sm font-medium text-foreground flex-1 mr-2"
              numberOfLines={1}
            >
              {item.exerciseName ?? item.exerciseId}
            </Text>
            {item.trendStatus ? (
              <SuggestionBadge
                trendStatus={
                  item.trendStatus as "improving" | "plateau" | "declining"
                }
                suggestion={item.suggestion}
                compact
              />
            ) : null}
          </View>
          {item.suggestion?.message ? (
            <Text className="text-xs text-muted" numberOfLines={2}>
              {item.suggestion.message}
            </Text>
          ) : null}
          <Text className="text-xs text-muted/60 mt-1">
            Updated{" "}
            {new Date(item.lastCalculatedAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })}
          </Text>
        </Card>
      ))}
    </View>
  );
}
