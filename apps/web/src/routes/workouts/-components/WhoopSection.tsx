import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link2, Link2Off } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WhoopActivityPicker } from "@/components/workout/whoop-activity-picker";
import { formatDistance, derivePace } from "@life-tracker/api/lib/index";
import {
  type HrZoneDurations,
  HR_ZONE_COLORS,
  HR_ZONE_LABELS_FULL,
} from "@life-tracker/shared";

// ── HR Zone bar chart ─────────────────────────────────────────────────────────

function HrZoneChart({ zones }: { zones: HrZoneDurations }) {
  const values = [
    zones.zone_zero_milli ?? 0,
    zones.zone_one_milli ?? 0,
    zones.zone_two_milli ?? 0,
    zones.zone_three_milli ?? 0,
    zones.zone_four_milli ?? 0,
    zones.zone_five_milli ?? 0,
  ];

  const total = values.reduce((s, v) => s + v, 0);
  if (total === 0) return null;

  return (
    <div className="space-y-1.5">
      {values.map((ms, i) => {
        const pct = total > 0 ? Math.round((ms / total) * 100) : 0;
        if (pct === 0) return null;
        return (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-24 shrink-0 text-muted-foreground">
              {HR_ZONE_LABELS_FULL[i]}
            </span>
            <div className="flex-1 rounded-full bg-muted overflow-hidden h-3">
              <div
                className="h-3 rounded-full transition-all"
                style={{
                  width: `${pct}%`,
                  backgroundColor: HR_ZONE_COLORS[i],
                }}
              />
            </div>
            <span className="w-9 shrink-0 text-right text-muted-foreground">
              {pct}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Linked metrics display ────────────────────────────────────────────────────

export interface RunningLogMetrics {
  distanceMeter: number | null;
  durationSeconds: number | null;
  heartRate: number | null;
  intensity: number | null;
  hrZoneDurations: HrZoneDurations | null;
}

interface LinkedMetricsProps {
  runningLog: RunningLogMetrics | null;
  distanceUnit: "mi" | "km";
}

function LinkedMetrics({ runningLog, distanceUnit }: LinkedMetricsProps) {
  if (!runningLog) {
    return (
      <p className="text-sm text-muted-foreground">
        Whoop metrics not available for this workout.
      </p>
    );
  }

  const pace = derivePace(
    runningLog.distanceMeter,
    runningLog.durationSeconds,
    distanceUnit,
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 text-sm md:grid-cols-3">
        {runningLog.distanceMeter != null && (
          <div>
            <div className="text-muted-foreground">Distance</div>
            <div className="font-medium">
              {formatDistance(runningLog.distanceMeter, distanceUnit)}
            </div>
          </div>
        )}
        {pace != null && (
          <div>
            <div className="text-muted-foreground">Pace</div>
            <div className="font-medium">{pace}</div>
          </div>
        )}
        {runningLog.heartRate != null && (
          <div>
            <div className="text-muted-foreground">Avg HR</div>
            <div className="font-medium">{runningLog.heartRate} bpm</div>
          </div>
        )}
        {runningLog.intensity != null && (
          <div>
            <div className="text-muted-foreground">Strain / Intensity</div>
            <div className="font-medium">{runningLog.intensity}</div>
          </div>
        )}
      </div>

      {runningLog.hrZoneDurations && (
        <div>
          <div className="mb-2 text-sm text-muted-foreground font-medium">
            HR Zones
          </div>
          <HrZoneChart zones={runningLog.hrZoneDurations} />
        </div>
      )}
    </div>
  );
}

// ── Whoop section (view mode only) ───────────────────────────────────────────

export interface WhoopSectionProps {
  workoutId: string;
  workoutDate: string;
  whoopActivityId: string | null | undefined;
  runningLog: RunningLogMetrics | null;
  distanceUnit: "mi" | "km";
}

export function WhoopSection({
  workoutId,
  workoutDate,
  whoopActivityId,
  runningLog,
  distanceUnit,
}: WhoopSectionProps) {
  const queryClient = useQueryClient();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(
    null,
  );
  const [unlinkConfirmOpen, setUnlinkConfirmOpen] = useState(false);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [pendingActivityId, setPendingActivityId] = useState<string | null>(
    null,
  );

  const linkMutation = useMutation(
    trpc.whoop.linkToWorkout.mutationOptions({
      onSuccess: (data) => {
        if (data.metricConflict) {
          setPendingActivityId(selectedActivityId);
          setPickerOpen(false);
          setConflictOpen(true);
          return;
        }
        setPickerOpen(false);
        setSelectedActivityId(null);
        toast.success("Whoop run linked");
        queryClient.invalidateQueries({
          queryKey: trpc.workouts.get.queryOptions({ id: workoutId }).queryKey,
        });
      },
      onError: (err) => {
        toast.error(err.message || "Failed to link Whoop run");
      },
    }),
  );

  const linkForced = useMutation(
    trpc.whoop.linkToWorkout.mutationOptions({
      onSuccess: () => {
        setConflictOpen(false);
        setPendingActivityId(null);
        setSelectedActivityId(null);
        toast.success("Whoop run linked (metrics overwritten)");
        queryClient.invalidateQueries({
          queryKey: trpc.workouts.get.queryOptions({ id: workoutId }).queryKey,
        });
      },
      onError: (err) => {
        toast.error(err.message || "Failed to link Whoop run");
      },
    }),
  );

  const unlinkMutation = useMutation(
    trpc.whoop.unlinkFromWorkout.mutationOptions({
      onSuccess: () => {
        setUnlinkConfirmOpen(false);
        toast.success("Whoop run unlinked");
        queryClient.invalidateQueries({
          queryKey: trpc.workouts.get.queryOptions({ id: workoutId }).queryKey,
        });
      },
      onError: (err) => {
        toast.error(err.message || "Failed to unlink Whoop run");
      },
    }),
  );

  const handleLink = () => {
    if (!selectedActivityId) return;
    linkMutation.mutate({ workoutId, whoopActivityId: selectedActivityId });
  };

  const handleForceLink = () => {
    if (!pendingActivityId) return;
    linkForced.mutate({
      workoutId,
      whoopActivityId: pendingActivityId,
      force: true,
    });
  };

  const isLinked = !!whoopActivityId;

  return (
    <>
      <Separator className="my-6" />
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Link2 className="h-4 w-4" />
            Whoop
          </h2>
          {isLinked ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground gap-1"
              onClick={() => setUnlinkConfirmOpen(true)}
              disabled={unlinkMutation.isPending}
            >
              <Link2Off className="h-3.5 w-3.5" />
              Unlink
            </Button>
          ) : null}
        </div>

        {isLinked ? (
          <LinkedMetrics runningLog={runningLog} distanceUnit={distanceUnit} />
        ) : (
          <div className="rounded-md border border-dashed border-border p-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">No Whoop run linked</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPickerOpen(true)}
              className="gap-1.5"
            >
              <Link2 className="h-3.5 w-3.5" />
              Link Whoop Run
            </Button>
          </div>
        )}
      </div>

      {/* Picker dialog */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Link Whoop Run</DialogTitle>
            <DialogDescription>
              Select a Whoop activity within 3 days of this workout to link.
            </DialogDescription>
          </DialogHeader>
          <WhoopActivityPicker
            workoutDate={workoutDate}
            selectedActivityId={selectedActivityId}
            onSelect={setSelectedActivityId}
            distanceUnit={distanceUnit}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPickerOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!selectedActivityId || linkMutation.isPending}
              onClick={handleLink}
            >
              {linkMutation.isPending ? "Linking…" : "Link Activity"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Conflict confirmation dialog */}
      <Dialog open={conflictOpen} onOpenChange={setConflictOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Overwrite existing metrics?</DialogTitle>
            <DialogDescription>
              This workout already has heart rate or intensity data. Linking
              this Whoop activity will overwrite those values with Whoop data.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConflictOpen(false);
                setPendingActivityId(null);
              }}
            >
              Keep My Data
            </Button>
            <Button onClick={handleForceLink} disabled={linkForced.isPending}>
              {linkForced.isPending ? "Linking…" : "Use Whoop Data"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unlink confirmation dialog */}
      <Dialog open={unlinkConfirmOpen} onOpenChange={setUnlinkConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unlink Whoop run?</DialogTitle>
            <DialogDescription>
              This will remove the Whoop activity link and clear all
              Whoop-sourced metrics (distance, heart rate, zones) from this
              workout.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setUnlinkConfirmOpen(false)}
              disabled={unlinkMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => unlinkMutation.mutate({ workoutId })}
              disabled={unlinkMutation.isPending}
            >
              {unlinkMutation.isPending ? "Unlinking…" : "Unlink"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
