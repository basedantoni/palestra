import { useState } from "react";
import { format } from "date-fns";
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { formatDistance } from "@src/api/lib/index";
import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WhoopActivityPicker } from "./whoop-activity-picker";
import type { WhoopActivity } from "./whoop-activity-picker";

interface WhoopLinkCardProps {
  workoutDate: string;
  selectedActivityId: string | null;
  selectedActivity: WhoopActivity | null;
  isOpen: boolean;
  distanceUnit?: "mi" | "km";
  onToggle: () => void;
  onSelect: (activityId: string | null) => void;
}

export function WhoopLinkCard({
  workoutDate,
  selectedActivityId,
  selectedActivity,
  isOpen,
  distanceUnit = "mi",
  onToggle,
  onSelect,
}: WhoopLinkCardProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const queryClient = useQueryClient();

  const unlinkMutation = useMutation(
    trpc.whoop.unlinkFromWorkout.mutationOptions({
      onSuccess: () => {
        // queryOptions() with no args gives the base key prefix — matches all date variants
        queryClient.invalidateQueries({
          queryKey: trpc.whoop.listUnlinkedCardioActivities.queryOptions({ date: "" }).queryKey.slice(0, 1),
        });
        setConfirmOpen(false);
      },
    }),
  );

  const isReassign =
    selectedActivity?.alreadyLinked === true &&
    selectedActivity.linkedWorkoutId != null;

  const handleConfirm = () => {
    if (isReassign && selectedActivity?.linkedWorkoutId) {
      unlinkMutation.mutate({ workoutId: selectedActivity.linkedWorkoutId });
    } else {
      onSelect(null);
      setConfirmOpen(false);
    }
  };

  return (
    <div className="mt-6 rounded-md border border-border overflow-hidden">
      {/* Header — click to expand/collapse */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-muted transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Link Whoop Run</span>
          {selectedActivity && (
            <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              Selected
            </span>
          )}
        </div>
        {isOpen ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {/* Selected activity summary */}
      {selectedActivity && (
        <div className="border-t border-border bg-muted/30 px-4 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {selectedActivity.sportName}
              </span>
              <span className="mx-1.5">·</span>
              <span>{format(new Date(selectedActivity.start), "MMM d, h:mm a")}</span>
              <span className="mx-1.5">·</span>
              <span>{selectedActivity.durationMinutes} min</span>
              {selectedActivity.averageHeartRate != null && (
                <>
                  <span className="mx-1.5">·</span>
                  <span>{selectedActivity.averageHeartRate} bpm</span>
                </>
              )}
              {selectedActivity.distanceMeter != null && (
                <>
                  <span className="mx-1.5">·</span>
                  <span>{formatDistance(selectedActivity.distanceMeter, distanceUnit)}</span>
                </>
              )}
              {isReassign && selectedActivity.linkedWorkoutDate && (
                <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                  Linked to {format(new Date(selectedActivity.linkedWorkoutDate), "MMM d")} workout
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setConfirmOpen(true);
              }}
              className="shrink-0 text-xs text-muted-foreground hover:text-destructive transition-colors"
            >
              {isReassign ? "Reassign" : "Remove"}
            </button>
          </div>
        </div>
      )}

      {/* Expanded picker */}
      {isOpen && (
        <div className="border-t border-border px-4 py-3">
          <WhoopActivityPicker
            workoutDate={workoutDate}
            selectedActivityId={selectedActivityId}
            onSelect={onSelect}
            distanceUnit={distanceUnit}
          />
        </div>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isReassign ? "Reassign Whoop activity?" : "Unlink Whoop activity?"}
            </DialogTitle>
            <DialogDescription>
              {isReassign && selectedActivity?.linkedWorkoutDate
                ? `This will unlink "${selectedActivity.sportName}" from the ${format(new Date(selectedActivity.linkedWorkoutDate), "MMM d")} workout and link it to this one instead. That workout's Whoop metrics will be cleared.`
                : selectedActivity
                  ? `This will remove "${selectedActivity.sportName}" from this workout. No Whoop metrics will be saved.`
                  : "This will remove the linked Whoop activity."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={unlinkMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirm}
              disabled={unlinkMutation.isPending}
            >
              {unlinkMutation.isPending
                ? "Unlinking…"
                : isReassign
                  ? "Reassign"
                  : "Remove"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
