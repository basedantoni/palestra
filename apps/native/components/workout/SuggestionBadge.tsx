import { Ionicons } from "@expo/vector-icons";
import { Text, View } from "react-native";

interface SuggestionBadgeProps {
  trendStatus: "improving" | "plateau" | "declining";
  suggestion: {
    type: string;
    message: string;
    details: { currentValue: number; suggestedValue: number; unit: string };
  } | null;
  compact?: boolean;
}

const TREND_CONFIG = {
  improving: {
    containerClass:
      "flex-row items-center gap-1 px-2 py-1 rounded-full bg-green-100 dark:bg-green-900/30 self-start",
    textClass: "text-xs font-medium text-green-700 dark:text-green-400",
    iconName: "trending-up" as const,
    iconColor: "#15803d",
    label: "Improving",
  },
  plateau: {
    containerClass:
      "flex-row items-center gap-1 px-2 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30 self-start",
    textClass: "text-xs font-medium text-amber-700 dark:text-amber-400",
    iconName: "remove" as const,
    iconColor: "#b45309",
    label: "Plateau",
  },
  declining: {
    containerClass:
      "flex-row items-center gap-1 px-2 py-1 rounded-full bg-red-100 dark:bg-red-900/30 self-start",
    textClass: "text-xs font-medium text-red-700 dark:text-red-400",
    iconName: "trending-down" as const,
    iconColor: "#b91c1c",
    label: "Declining",
  },
};

export function SuggestionBadge({
  trendStatus,
  suggestion,
  compact = false,
}: SuggestionBadgeProps) {
  const config = TREND_CONFIG[trendStatus];

  return (
    <View className={config.containerClass}>
      <Ionicons name={config.iconName} size={12} color={config.iconColor} />
      <Text className={config.textClass}>
        {compact ? config.label : (suggestion?.message ?? config.label)}
      </Text>
    </View>
  );
}
