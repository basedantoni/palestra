import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  RECORD_TYPE_LABELS,
  formatPrValue,
  formatPrDelta,
  isPrImprovement,
} from "@src/api/lib/index";

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

interface PersonalRecordsGridProps {
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
    <ol className="mt-2 space-y-2 border-l border-border pl-3">
      {ordered.map((entry, i) => {
        const delta =
          entry.previousRecordValue != null
            ? entry.value - entry.previousRecordValue
            : null;
        return (
          <li key={i} className="relative">
            <span className="absolute -left-[17px] top-1.5 h-2 w-2 rounded-full bg-border" />
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">
                {formatPrValue(recordType, entry.value, distanceUnit)}
              </span>
              {delta != null ? (
                <span
                  className={cn(
                    "text-xs font-medium",
                    isPrImprovement(recordType, delta)
                      ? "text-green-600"
                      : "text-destructive",
                  )}
                >
                  {formatPrDelta(recordType, delta, distanceUnit)}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">First PR</span>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              {formatDate(entry.dateAchieved)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function PersonalRecordsGrid({
  data,
  isLoading,
  distanceUnit = "mi",
}: PersonalRecordsGridProps) {
  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-48" />
        ))}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center rounded-md border border-dashed">
        <p className="text-sm text-muted-foreground">
          No personal records yet. Keep training!
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {data.map((exercise) => (
        <Card key={exercise.exerciseId}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">
              {exercise.exerciseName}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {exercise.recordsByType.map((rt) => (
              <div key={rt.recordType}>
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline" className="shrink-0 text-xs">
                    {RECORD_TYPE_LABELS[rt.recordType] ?? rt.recordType}
                  </Badge>
                  <span className="text-base font-bold">
                    {formatPrValue(rt.recordType, rt.currentBest, distanceUnit)}
                  </span>
                </div>
                {rt.progression.length > 1 && (
                  <ProgressionTimeline
                    recordType={rt.recordType}
                    progression={rt.progression}
                    distanceUnit={distanceUnit}
                  />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
