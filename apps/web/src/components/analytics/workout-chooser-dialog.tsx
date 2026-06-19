import { useNavigate } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface WorkoutChooserTarget {
  /** Workout ids backing a single chart point. */
  workoutIds: string[];
  /** Human-readable label for the point (e.g. the date). */
  label?: string;
  /** Optional secondary label (e.g. the exercise name). */
  description?: string;
}

interface WorkoutChooserDialogProps {
  target: WorkoutChooserTarget | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Disambiguation dialog shown when a clicked chart point maps to more than one
 * workout. Lists the underlying runs and navigates to the chosen workout.
 * Shared by the running pace trend and Whoop trend charts.
 */
export function WorkoutChooserDialog({
  target,
  onOpenChange,
}: WorkoutChooserDialogProps) {
  const navigate = useNavigate();

  return (
    <Dialog open={target != null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Open a run</DialogTitle>
          <DialogDescription>
            {target?.label
              ? `${target.label}${target.description ? ` · ${target.description}` : ""} has multiple runs. Pick one to view.`
              : "This point has multiple runs. Pick one to view."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {(target?.workoutIds ?? []).map((workoutId, index) => (
            <Button
              key={workoutId}
              variant="outline"
              className="justify-start"
              onClick={() => {
                onOpenChange(false);
                navigate({
                  to: "/workouts/$workoutId",
                  params: { workoutId },
                });
              }}
            >
              Run {index + 1}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
