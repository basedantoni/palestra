import { Minus, TrendingDown, TrendingUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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
    variant: "default" as const,
    icon: TrendingUp,
    label: "Improving",
    className: "",
  },
  plateau: {
    variant: "outline" as const,
    icon: Minus,
    label: "Plateau",
    className: "text-amber-600 border-amber-300",
  },
  declining: {
    variant: "destructive" as const,
    icon: TrendingDown,
    label: "Declining",
    className: "",
  },
};

export function SuggestionBadge({
  trendStatus,
  suggestion,
  compact = false,
}: SuggestionBadgeProps) {
  const config = TREND_CONFIG[trendStatus];
  const Icon = config.icon;

  if (compact) {
    return (
      <Badge
        variant={config.variant}
        className={cn("gap-1", config.className)}
      >
        <Icon className="h-3 w-3" />
        {config.label}
      </Badge>
    );
  }

  return (
    <Badge
      variant={config.variant}
      className={cn("h-auto max-w-full whitespace-normal py-1", config.className)}
    >
      <Icon className="mr-1 h-3 w-3 shrink-0" />
      <span className="text-xs">
        {suggestion ? suggestion.message : config.label}
      </span>
    </Badge>
  );
}
