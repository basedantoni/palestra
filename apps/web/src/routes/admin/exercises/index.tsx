import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { format } from "date-fns";

import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EXERCISE_CATEGORY_LABELS } from "@src/api/lib/index";

export const Route = createFileRoute("/admin/exercises/")({
  component: AdminExercisesPage,
});

function AdminExercisesPage() {
  const queryClient = useQueryClient();
  const [rejectDialogId, setRejectDialogId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const { data: pendingExercises = [], isLoading } = useQuery(
    trpc.admin.pendingExercises.queryOptions(),
  );

  const invalidatePending = () => {
    void queryClient.invalidateQueries();
  };

  const approveMutation = useMutation(
    trpc.admin.approveExercise.mutationOptions({
      onSuccess: (updated) => {
        toast.success(`"${updated.name}" approved and added to public library`);
        invalidatePending();
      },
      onError: (err) => {
        toast.error(err.message || "Failed to approve exercise");
      },
    }),
  );

  const rejectMutation = useMutation(
    trpc.admin.rejectExercise.mutationOptions({
      onSuccess: () => {
        toast.success("Exercise rejected");
        setRejectDialogId(null);
        setRejectReason("");
        invalidatePending();
      },
      onError: (err) => {
        toast.error(err.message || "Failed to reject exercise");
      },
    }),
  );

  const handleReject = () => {
    if (!rejectDialogId) return;
    rejectMutation.mutate({
      id: rejectDialogId,
      reason: rejectReason.trim() || undefined,
    });
  };

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-xl font-semibold">Exercise Review Queue</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Review user-submitted and imported exercises for public library inclusion.
        </p>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : pendingExercises.length === 0 ? (
        <div className="rounded border p-8 text-center text-sm text-muted-foreground">
          No exercises to review.
        </div>
      ) : (
        <div className="divide-y border">
          {pendingExercises.map(({ exercise: ex, submittedBy }) => (
            <div
              key={ex.id}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium">{ex.name}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Badge variant="secondary" className="text-xs">
                    {EXERCISE_CATEGORY_LABELS[ex.category]}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {ex.exerciseType}
                  </Badge>
                  {ex.status === "imported" && (
                    <Badge variant="outline" className="text-xs border-blue-400 text-blue-600">
                      Imported
                    </Badge>
                  )}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  By {submittedBy.name} ({submittedBy.email}) &middot;{" "}
                  {format(new Date(ex.createdAt), "MMM d, yyyy")}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-green-500 text-green-600 hover:bg-green-50 dark:hover:bg-green-950"
                  disabled={approveMutation.isPending}
                  onClick={() => approveMutation.mutate({ id: ex.id })}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-red-500 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                  onClick={() => {
                    setRejectDialogId(ex.id);
                    setRejectReason("");
                  }}
                >
                  Reject
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Reject dialog */}
      <Dialog
        open={rejectDialogId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRejectDialogId(null);
            setRejectReason("");
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reject Exercise</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              The user will not be notified of the reason, but it will be stored
              for admin reference.
            </p>
            <div className="space-y-1">
              <Label htmlFor="reject-reason">Reason (optional)</Label>
              <Input
                id="reject-reason"
                placeholder="e.g. Duplicate of existing exercise"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRejectDialogId(null);
                setRejectReason("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={rejectMutation.isPending}
            >
              {rejectMutation.isPending ? "Rejecting..." : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
