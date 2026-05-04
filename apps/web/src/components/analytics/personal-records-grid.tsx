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

interface PersonalRecordsGridProps {
  data: ExerciseGroup[];
  isLoading: boolean;
  distanceUnit?: "mi" | "km";
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
          <Skeleton key={i} className="h-32" />
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
          <CardContent className="space-y-2">
            {exercise.records.map((record, i) => (
              <div key={i} className="flex items-center justify-between gap-2">
                <Badge variant="outline" className="shrink-0 text-xs">
                  {RECORD_TYPE_LABELS[record.recordType] ?? record.recordType}
                </Badge>
                <span className="text-sm font-medium">
                  {formatPrValue(record.recordType, record.value, distanceUnit)}
                </span>
                {record.delta != null ? (
                  <span
                    className={cn(
                      "text-xs font-medium",
                      isPrImprovement(record.recordType, record.delta)
                        ? "text-green-600"
                        : "text-destructive",
                    )}
                  >
                    {formatPrDelta(record.recordType, record.delta, distanceUnit)}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">First PR</span>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
