import { CheckCircle } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface CompleteStepProps {
  importedCount: number;
  skippedCount: number;
  createdExerciseCount: number;
  onImportAnother: () => void;
}

export function CompleteStep({
  importedCount,
  skippedCount,
  createdExerciseCount,
  onImportAnother,
}: CompleteStepProps) {
  const navigate = useNavigate();
  return (
    <div className="space-y-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <CheckCircle className="size-16 text-green-500" />
        <h2 className="text-2xl font-semibold">Import Complete!</h2>
        <p className="text-muted-foreground">
          Your workout history has been imported successfully.
        </p>
      </div>

      <Card>
        <CardContent className="py-4">
          <div className="flex justify-center gap-8">
            <div className="text-center">
              <p className="text-2xl font-bold">{importedCount}</p>
              <p className="text-xs text-muted-foreground">Workouts Imported</p>
            </div>
            {createdExerciseCount > 0 && (
              <div className="text-center">
                <p className="text-2xl font-bold">{createdExerciseCount}</p>
                <p className="text-xs text-muted-foreground">
                  New Exercises Created
                </p>
              </div>
            )}
            {skippedCount > 0 && (
              <div className="text-center">
                <p className="text-2xl font-bold text-muted-foreground">
                  {skippedCount}
                </p>
                <p className="text-xs text-muted-foreground">Skipped</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <Button onClick={() => navigate({ to: "/workouts" })}>
          View Workouts
        </Button>
        <Button variant="outline" onClick={onImportAnother}>
          Import Another File
        </Button>
      </div>
    </div>
  );
}
