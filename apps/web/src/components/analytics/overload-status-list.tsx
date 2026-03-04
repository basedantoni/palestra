import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SuggestionBadge } from "@/components/workout/suggestion-badge";

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

interface OverloadStatusListProps {
  data: OverloadEntry[];
  isLoading: boolean;
}

const TREND_ORDER = { improving: 0, plateau: 1, declining: 2 };

export function OverloadStatusList({ data, isLoading }: OverloadStatusListProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-md border border-dashed">
        <p className="text-sm text-muted-foreground">
          No progressive overload data yet. You need at least 2 sessions per
          exercise for a suggestion to appear.
        </p>
      </div>
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
    <div className="space-y-3">
      {sorted.map((item) => (
        <Card key={item.exerciseId}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-sm font-medium">
                {item.exerciseName ?? item.exerciseId}
              </CardTitle>
              {item.trendStatus && (
                <SuggestionBadge
                  trendStatus={
                    item.trendStatus as "improving" | "plateau" | "declining"
                  }
                  suggestion={item.suggestion}
                  compact
                />
              )}
            </div>
          </CardHeader>
          {item.suggestion?.message && (
            <CardContent className="pt-0">
              <p className="text-xs text-muted-foreground">
                {item.suggestion.message}
              </p>
              <p className="mt-1 text-xs text-muted-foreground/60">
                Updated{" "}
                {new Date(item.lastCalculatedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </p>
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  );
}
